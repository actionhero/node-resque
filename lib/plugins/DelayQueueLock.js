// If a job with the same name, queue, and args is already in the delayed queue(s), do not enqueue it again

class DelayQueueLock {
  constructor (worker, func, queue, job, args, options) {
    this.name = 'DelayQueueLock'
    this.worker = worker
    this.queue = queue
    this.func = func
    this.job = job
    this.args = args
    this.options = options

    if (this.worker.queueObject) {
      this.queueObject = this.worker.queueObject
    } else {
      this.queueObject = this.worker
    }
  }

  async beforeEnqueue () {
    let timestamps = await this.queueObject.scheduledAt(this.queue, this.func, this.args)
    if (timestamps.length > 0) {
      return false
    } else {
      return true
    }
  }
}

exports.DelayQueueLock = DelayQueueLock
