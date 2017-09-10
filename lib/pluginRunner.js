var path = require('path')

async function RunPlugins (self, type, func, queue, job, args, pluginCounter) {
  if (!pluginCounter) { pluginCounter = 0 }

  if (!job) {
    return true
  }

  if (job.plugins === null || job.plugins === undefined || job.plugins.length === 0) {
    return true
  }

  if (pluginCounter >= job.plugins.length) {
    return true
  }

  let pluginRefrence = job.plugins[pluginCounter]
  let toRun = await RunPlugin(self, pluginRefrence, type, func, queue, job, args)
  pluginCounter++
  if (toRun === false) { return false }

  return RunPlugins(self, type, func, queue, job, args, pluginCounter)
}

async function RunPlugin (self, PluginRefrence, type, func, queue, job, args) {
  if (!job) { return true }

  let pluginName = PluginRefrence
  if (typeof pluginRefrence === 'function') {
    pluginName = new PluginRefrence(self, func, queue, job, args, {}).name
  }

  var pluginOptions = null
  if (self.jobs[func].pluginOptions && self.jobs[func].pluginOptions[pluginName]) {
    pluginOptions = self.jobs[func].pluginOptions[pluginName]
  } else {
    pluginOptions = {}
  }

  var plugin = null
  if (typeof PluginRefrence === 'string') {
    var PluginConstructor = require(path.join(__dirname, 'plugins', (PluginRefrence + '.js')))[PluginRefrence]
    plugin = new PluginConstructor(self, func, queue, job, args, pluginOptions)
  } else if (typeof PluginRefrence === 'function') {
    plugin = new PluginRefrence(self, func, queue, job, args, pluginOptions)
  } else {
    throw new Error('Plugin must be the constructor name or an object')
  }

  if (plugin[type] === null || plugin[type] === undefined || typeof plugin[type] !== 'function') {
    return true
  }

  return plugin[type]()
}

exports.RunPlugin = RunPlugin
exports.RunPlugins = RunPlugins
