const Ioredis = require('ioredis')
const specHelper = require('../utils/specHelper.js')
const NodeResque = require('../../index.js')

describe('connection', () => {
  beforeAll(async () => {
    await specHelper.connect()
    await specHelper.cleanup()
  })

  afterAll(async () => {
    await specHelper.cleanup()
    await specHelper.disconnect()
  })

  test('can provide an error if connection failed', async () => {
    const connectionDetails = {
      pkg: specHelper.connectionDetails.pkg,
      host: 'wrong-hostname',
      password: specHelper.connectionDetails.password,
      port: specHelper.connectionDetails.port,
      database: specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace
    }

    let connection = new NodeResque.Connection(connectionDetails)

    await new Promise((resolve) => {
      connection.connect()

      connection.on('error', (error) => {
        expect(error.message).toMatch(/getaddrinfo ENOTFOUND/)
        connection.end()
        resolve()
      })
    })
  })

  test('should stat with no redis keys in the namespace', async () => {
    let keys = await specHelper.redis.keys(specHelper.namespace + '*')
    expect(keys.length).toBe(0)
  })

  describe('keys and namespaces', () => {
    const db = specHelper.connectionDetails.database
    let connection
    beforeAll(async () => {
      connection = new NodeResque.Connection(specHelper.cleanConnectionDetails())
      await connection.connect()
    })

    let prefixedConnection
    let prefixedRedis
    beforeAll(async () => {
      prefixedRedis = new Ioredis({ keyPrefix: 'customNamespace:', db: db })
      prefixedConnection = new NodeResque.Connection({ redis: prefixedRedis, namespace: specHelper.namespace })
      await prefixedConnection.connect()
    })

    afterAll(async () => {
      connection.end()
      prefixedConnection.end()
      prefixedRedis.quit()
    })

    test('getKeys returns appropriate keys based on matcher given', async () => {
      // seed the DB with keys to test with
      await Promise.all(
        new Array(25).fill(0).map((v, i) => i + 1).map(async v => {
          await connection.redis.set(`test-key${v}`, v.toString())
          if (v <= 5) {
            await connection.redis.set(`test-not-key${v}`, v.toString())
          }
        })
      )

      // sanity checks to confirm keys above are set and exist
      expect(await connection.redis.get('test-key1')).toBe('1')
      expect(await connection.redis.get('test-key20')).toBe('20')
      expect(await connection.redis.get('test-not-key1')).toBe('1')
      expect(await connection.redis.get('test-not-key5')).toBe('5')

      const foundKeys = await connection.getKeys('test-key*')

      expect(foundKeys.length).toBe(25)
      expect(foundKeys).toContain('test-key1')
      expect(foundKeys).toContain('test-key5')
      expect(foundKeys).toContain('test-key20')
      expect(foundKeys).toContain('test-key25')
      expect(foundKeys).not.toContain('test-key50')
      expect(foundKeys).not.toContain('test-not-key1')
      expect(foundKeys).not.toContain('test-not-key3')
      expect(foundKeys).not.toContain('test-not-key5')
      expect(foundKeys).not.toContain('test-not-key50')
    })

    test('keys built with the default namespace are correct', () => {
      expect(connection.key('thing')).toBe(`resque-test-${db}:thing`)
      expect(prefixedConnection.key('thing')).toBe(`resque-test-${db}:thing`)
      // the value retunred by a redis prefix should match a plain redis connection
      expect(connection.key('thing')).toBe(prefixedConnection.key('thing'))
    })

    test('ioredis transparent key prefix writes keys with the prefix even if they are not returned', async () => {
      await connection.redis.set(connection.key('testPrefixKey'), 'abc123')
      await prefixedConnection.redis.set(prefixedConnection.key('testPrefixKey'), 'abc123')

      const result = await connection.redis.get(connection.key('testPrefixKey'))
      const prefixedResult = await prefixedConnection.redis.get(prefixedConnection.key('testPrefixKey'))
      expect(result).toBe('abc123')
      expect(prefixedResult).toBe('abc123')

      const keys = await connection.getKeys('*')
      expect(keys).toContain(`resque-test-${db}:testPrefixKey`)
      expect(keys).toContain(`customNamespace:resque-test-${db}:testPrefixKey`)
    })

    test('keys built with a custom namespace are correct', () => {
      connection.options.namespace = 'customNamespace'
      expect(connection.key('thing')).toBe(`customNamespace:thing`)

      prefixedConnection.options.namespace = 'customNamespace'
      expect(prefixedConnection.key('thing')).toBe(`customNamespace:thing`)
    })

    test('keys built with a array namespace are correct', () => {
      connection.options.namespace = ['custom', 'namespace']
      expect(connection.key('thing')).toBe(`custom:namespace:thing`)

      prefixedConnection.options.namespace = ['custom', 'namespace']
      expect(prefixedConnection.key('thing')).toBe(`custom:namespace:thing`)
    })

    test('will properly build namespace strings dynamically', async () => {
      connection.options.namespace = specHelper.namespace
      expect(connection.key('thing')).toBe(specHelper.namespace + ':thing')

      prefixedConnection.options.namespace = specHelper.namespace
      expect(prefixedConnection.key('thing')).toBe(specHelper.namespace + ':thing')

      expect(connection.key('thing')).toBe(prefixedConnection.key('thing'))
    })
  })

  test('will select redis db from options', async () => {
    let connectionDetails = specHelper.cleanConnectionDetails()
    connectionDetails.database = 9
    let connection = new NodeResque.Connection(connectionDetails)
    await connection.connect()
    expect(connection.redis.options.db).toBe(connectionDetails.database)
    connection.end()
  })

  test('removes empty namespace from generated key', async () => {
    let connectionDetails = specHelper.cleanConnectionDetails()
    connectionDetails['namespace'] = ''
    let connection = new NodeResque.Connection(connectionDetails)
    await connection.connect()
    expect(connection.key('thing')).toBe('thing')
    connection.end()
  })
})
