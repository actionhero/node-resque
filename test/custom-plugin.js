// Simple plugin to prevent all jobs
const NodeResque = require('../index.js')

class CustomPlugin extends NodeResque.Plugin {
  beforeEnqueue () {
    return false
  }

  afterEnqueue () {
    return false
  }

  beforePerform () {
    return false
  }

  afterPerform () {
    return false
  }
}

module.exports = CustomPlugin
