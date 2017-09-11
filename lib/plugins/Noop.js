const NodeResque = require('../../index.js')

class Noop extends NodeResque.Plugin {
  afterPerform () {
    if (this.worker.error) {
      if (typeof this.options.logger === 'function') {
        this.options.logger(this.worker.error)
      } else {
        console.log(this.worker.error)
      }
      delete this.worker.error
    }

    return true
  }
}

exports.Noop = Noop
