const Redis = require('ioredis')
const namespace = `resque-test-${(process.env.JEST_WORKER_ID || 0)}`
const queue = 'test_queue'
const pkg = 'ioredis'
const NodeResque = require('../../index.js')

module.exports = {
  pkg: pkg,
  namespace: namespace,
  queue: queue,
  timeout: 500,
  connectionDetails: {
    pkg: pkg,
    host: '127.0.0.1',
    password: '',
    port: 6379,
    database: parseInt(process.env.JEST_WORKER_ID || 0),
    namespace: namespace
    // looping: true
  },

  connect: async function () {
    this.redis = Redis.createClient(this.connectionDetails.port, this.connectionDetails.host, this.connectionDetails.options)
    this.redis.setMaxListeners(0)
    if (this.connectionDetails.password !== null && this.connectionDetails.password !== '') {
      await this.redis.auth(this.connectionDetails.password)
    }
    await this.redis.select(this.connectionDetails.database)
    this.connectionDetails.redis = this.redis
  },

  cleanup: async function () {
    let keys = await this.redis.keys(this.namespace + '*')
    if (keys.length > 0) { await this.redis.del(keys) }
  },

  disconnect: async function () {
    if (typeof this.redis.disconnect === 'function') {
      await this.redis.disconnect()
    } else if (typeof this.redis.quit === 'function') {
      await this.redis.quit()
    }

    delete this.redis
    delete this.connectionDetails.redis
  },

  startAll: async function (jobs) {
    let Worker = NodeResque.Worker
    let Scheduler = NodeResque.Scheduler
    let Queue = NodeResque.Queue

    this.worker = new Worker({ connection: { redis: this.redis }, queues: this.queue, timeout: this.timeout }, jobs)
    await this.worker.connect()

    this.scheduler = new Scheduler({ connection: { redis: this.redis }, timeout: this.timeout })
    await this.scheduler.connect()

    this.queue = new Queue({ connection: { redis: this.redis } })
    await this.queue.connect()
  },

  endAll: async function () {
    await this.worker.end()
    await this.scheduler.end()
  },

  popFromQueue: async function () {
    return this.redis.lpop(this.namespace + ':queue:' + this.queue)
  },

  cleanConnectionDetails: function () {
    let out = {}
    for (let i in this.connectionDetails) {
      if (i !== 'redis') { out[i] = this.connectionDetails[i] }
    }

    return out
  }
}
