// To read notes about the master locking scheme, check out:
//   https://github.com/resque/resque-scheduler/blob/master/lib/resque/scheduler/locking.rb

const EventEmitter = require('events').EventEmitter
const os = require('os')
const path = require('path')
const Queue = require(path.join(__dirname, 'queue.js')).Queue

class Scheduler extends EventEmitter {
  constructor (options, jobs) {
    super()
    if (!jobs) { jobs = {} }

    const defaults = {
      timeout: 5000,                          // in ms
      masterLockTimeout: 60 * 3,              // in seconds
      name: os.hostname() + ':' + process.pid // assumes only one worker per node process
    }

    for (let i in defaults) {
      if (options[i] === null || options[i] === undefined) { options[i] = defaults[i] }
    }

    this.options = options
    this.name = this.options.name
    this.master = false
    this.running = false
    this.processing = false

    this.queue = new Queue({connection: options.connection}, jobs)
    this.queue.on('error', (error) => { this.emit('error', error) })
  }

  async connect () {
    await this.queue.connect()
    this.connection = this.queue.connection
  }

  async start () {
    this.processing = false

    if (!this.running) {
      this.emit('start')
      this.running = true
      this.pollAgainLater()
    }
  }

  async end () {
    this.running = false
    clearTimeout(this.timer)

    if (this.processing === false) {
      await this.releaseMasterLock()
      await this.queue.end()
      this.emit('end')
    } else {
      setTimeout(async () => {
        await this.end()
      }, (this.options.timeout / 2))
    }
  }

  async poll () {
    this.processing = true
    clearTimeout(this.timer)
    let isMaster = await this.tryForMaster()

    if (!isMaster) {
      this.master = false
      this.processing = false
      return this.pollAgainLater()
    }

    if (!this.master) {
      this.master = true
      this.emit('master')
    }

    this.emit('poll')
    let timestamp = await this.nextDelayedTimestamp()
    if (timestamp) {
      this.emit('workingTimestamp', timestamp)
      await this.enqueueDelayedItemsForTimestamp(timestamp)
      return this.poll()
    } else {
      this.processing = false
      return this.pollAgainLater()
    }
  }

  async pollAgainLater () {
    if (this.running === true) {
      this.timer = setTimeout(() => { this.poll() }, this.options.timeout)
    }
  }

  masterKey () {
    return this.connection.key('resque_scheduler_master_lock')
  }

  async tryForMaster () {
    const masterKey = this.masterKey()
    if (!this.connection || !this.connection.redis) { return }

    let lockedByMe = await this.connection.redis.setnx(masterKey, this.options.name)
    if (lockedByMe === true || lockedByMe === 1) {
      await this.connection.redis.expire(masterKey, this.options.masterLockTimeout)
      return true
    }

    let currentMasterName = await this.connection.redis.get(masterKey)
    if (currentMasterName === this.options.name) {
      await this.connection.redis.expire(masterKey, this.options.masterLockTimeout)
      return true
    }

    return false
  }

  async releaseMasterLock () {
    if (!this.connection || !this.connection.redis) { return }

    let isMaster = await this.tryForMaster()
    if (!isMaster) { return false }

    let delted = await this.connection.redis.del(this.masterKey())
    this.master = false
    return (delted === 1 || delted === true)
  }

  async nextDelayedTimestamp () {
    let time = Math.round(new Date().getTime() / 1000)
    let items = await this.connection.redis.zrangebyscore(
      this.connection.key('delayed_queue_schedule'),
      '-inf',
      time,
      'limit',
      0,
      1
    )
    if (items.length === 0) { return }
    return items[0]
  }

  async enqueueDelayedItemsForTimestamp (timestamp) {
    let job = await this.nextItemForTimestamp(timestamp)
    if (job) {
      await this.transfer(timestamp, job)
      await this.enqueueDelayedItemsForTimestamp(timestamp)
    } else {
      await this.cleanupTimestamp(timestamp)
    }
  }

  async nextItemForTimestamp (timestamp) {
    let key = this.connection.key('delayed:' + timestamp)
    let job = await this.connection.redis.lpop(key)
    await this.connection.redis.srem(this.connection.key('timestamps:' + job), ('delayed:' + timestamp))
    return JSON.parse(job)
  }

  async transfer (timestamp, job) {
    await this.queue.enqueue(job.queue, job['class'], job.args)
    this.emit('transferredJob', timestamp, job)
  }

  async cleanupTimestamp (timestamp) {
    let key = this.connection.key('delayed:' + timestamp)
    let length = await this.connection.redis.llen(key)
    if (length === 0) {
      await this.connection.redis.del(key)
      await this.connection.redis.zrem(this.connection.key('delayed_queue_schedule'), timestamp)
    }
  }
}

exports.Scheduler = Scheduler
