const path = require('path')
const Redis = require('ioredis')
const namespace = 'resque'
const queue = 'test_queue'
const pkg = 'ioredis'
const NodeResque = require(path.join(__dirname, '..', 'index.js'))

console.log(`Using redis client: ${pkg}`)

process.on('unhandledRejection', (reason, p) => {
  // console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
})

exports.specHelper = {
  pkg: pkg,
  namespace: namespace,
  queue: queue,
  timeout: 500,
  tasksAreUnique: true,
  connectionDetails: {
    pkg: pkg,
    host: '127.0.0.1',
    password: '',
    port: 6379,
    database: 2,
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

  startAll: async function (jobs) {
    let Worker = NodeResque.Worker
    let Scheduler = NodeResque.Scheduler
    let Queue = NodeResque.Queue

    this.worker = new Worker({connection: {redis: this.redis}, queues: this.queue, timeout: this.timeout, tasksAreUnique: this.tasksAreUnique}, jobs)
    await this.worker.connect()

    this.scheduler = new Scheduler({connection: {redis: this.redis}, timeout: this.timeout, tasksAreUnique: this.tasksAreUnique})
    await this.scheduler.connect()

    this.queue = new Queue({connection: {redis: this.redis, tasksAreUnique: this.tasksAreUnique}})
    await this.queue.connect()
  },

  endAll: async function () {
    await this.worker.end()
    await this.scheduler.end()
  },

  popFromQueue: async function () {
    let key = this.namespace + ':queue:' + this.queue
    if (this.tasksAreUnique) {
      return this.redis.zrange(key, 0, 0)
    }

    return this.redis.lpop(key)
  },

  cleanConnectionDetails: function () {
    let out = {}
    for (let i in this.connectionDetails) {
      if (i !== 'redis') { out[i] = this.connectionDetails[i] }
    }

    return out
  }
}
