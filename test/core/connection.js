const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should') // eslint-disable-line
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

describe('connection', () => {
  before(async () => {
    await specHelper.connect()
    await specHelper.cleanup()
  })

  after(async () => { await specHelper.cleanup() })

  it('can provide an error if connection failed', async () => {
    const connectionDetails = {
      pkg: specHelper.connectionDetails.pkg,
      host: 'wronghostname',
      password: specHelper.connectionDetails.password,
      port: specHelper.connectionDetails.port,
      database: specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace
    }

    let connection = new NodeResque.Connection(connectionDetails)

    await new Promise((resolve) => {
      connection.connect()

      connection.on('error', (error) => {
        error.message.should.match(/getaddrinfo ENOTFOUND/)
        connection.end()
        resolve()
      })
    })
  })

  it('should stat with no redis keys in the namespace', async () => {
    let keys = await specHelper.redis.keys(specHelper.namespace + '*')
    keys.length.should.equal(0)
  })

  it('will properly build namespace strings', async () => {
    let connection = new NodeResque.Connection(specHelper.cleanConnectionDetails())
    await connection.connect()
    connection.key('thing').should.equal(specHelper.namespace + ':thing')
    connection.end()
  })

  it('removes empty namespace from generated key', async () => {
    let connectionDetails = specHelper.cleanConnectionDetails()
    connectionDetails['namespace'] = ''
    let connection = new NodeResque.Connection(connectionDetails)
    await connection.connect()
    connection.key('thing').should.equal('thing')
    connection.end()
  })
})
