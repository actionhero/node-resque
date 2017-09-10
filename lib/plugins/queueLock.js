const NodeResque = require('../../index.js')
// If a job with the same name, queue, and args is already in the queue, do not enqueue it again

class QueueLock extends NodeResque.Plugin {
  async beforeEnqueue () {
    let key = this.key()
    let now = Math.round(new Date().getTime() / 1000)
    let timeout = now + this.lockTimeout() + 1
    let set = await this.queueObject.connection.redis.setnx(key, timeout)
    if (set === true || set === 1) { return true }

    let redisTimeout = await this.queueObject.connection.redis.get(key)
    redisTimeout = parseInt(redisTimeout)
    if (now <= redisTimeout) { return false }

    await this.queueObject.connection.redis.set(key, timeout)
    await this.queueObject.connection.redis.expire(key, timeout)
    return true
  }

  async afterPerform () {
    let key = this.key()
    await this.queueObject.connection.redis.del(key)
    return true
  }

  lockTimeout () {
    if (this.options.lockTimeout) {
      return this.options.lockTimeout
    } else {
      return 3600 // in seconds
    }
  }

  key () {
    if (this.options.key) {
      return typeof this.options.key === 'function' ? this.options.key.apply(this) : this.options.key
    } else {
      var flattenedArgs = JSON.stringify(this.args)
      return this.queueObject.connection.key('lock', this.func, this.queue, flattenedArgs)
    }
  }
}

exports.QueueLock = QueueLock
