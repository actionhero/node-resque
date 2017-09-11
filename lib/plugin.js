// Plugin Template class

class Plugin {
  constructor (worker, func, queue, job, args, options) {
    this.name = 'CustomPlugin'
    this.worker = worker
    this.queue = queue
    this.func = func
    this.job = job
    this.args = args
    this.options = options

    if (this.worker && this.worker.queueObject) {
      this.queueObject = this.worker.queueObject
    } else {
      this.queueObject = this.worker
    }
  }

  // beforeEnqueue () {
  //   return true
  // }

  // afterEnqueue () {
  //   return true
  // }

  // beforePerform () {
  //   return true
  // }

  // afterPerform () {
  //   return true
  // }
}

exports.Plugin = Plugin
