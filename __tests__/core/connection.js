const path = require('path')
const specHelper = require(path.join(__dirname, '..', 'utils', 'specHelper.js'))
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

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

  test('will properly build namespace strings', async () => {
    let connection = new NodeResque.Connection(specHelper.cleanConnectionDetails())
    await connection.connect()
    expect(connection.key('thing')).toBe(specHelper.namespace + ':thing')
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
