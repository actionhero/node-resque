// If a job with the same name, queue, and args is already running, put this job back in the queue and try later
const NodeResque = require('../../index.js')

class JobLock extends NodeResque.Plugin {
  async beforePerform () {
    let key = this.key()
    let now = Math.round(new Date().getTime() / 1000)
    let timeout = now + this.lockTimeout() + 1
    let setCallback = await this.queueObject.connection.redis.setnx(key, timeout)
    if (setCallback === true || setCallback === 1) {
      await this.queueObject.connection.redis.expire(key, this.lockTimeout())
      return true
    } else {
      await this.reEnqueue()
      return false
    }
  }

  async afterPerform () {
    let key = this.key()
    await this.queueObject.connection.redis.del(key)
    return true
  }

  async reEnqueue () {
    await this.queueObject.enqueueIn(this.enqueueTimeout(), this.queue, this.func, this.args)
  }

  lockTimeout () {
    if (this.options.lockTimeout) {
      return this.options.lockTimeout
    } else {
      return 3600 // in seconds
    }
  }

  enqueueTimeout () {
    if (this.options.enqueueTimeout) {
      return this.options.enqueueTimeout
    } else {
      return 1001 // in ms
    }
  }

  key () {
    if (this.options.key) {
      return typeof this.options.key === 'function' ? this.options.key.apply(this) : this.options.key
    } else {
      var flattenedArgs = JSON.stringify(this.args)
      return this.worker.connection.key('workerslock', this.func, this.queue, flattenedArgs)
    }
  }
}

exports.JobLock = JobLock
