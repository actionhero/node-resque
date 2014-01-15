var runPlugin = function(pluginRefrence, type, func, queue, job, args, callback){
  var self = this;
  process.nextTick(function(){
    if(job == null){
      callback(null, true);
    }else{
      
      var pluginName = pluginRefrence;
      if(typeof pluginRefrence === 'function'){
        pluginName = new pluginRefrence().name;
      }

      if(self.jobs[func]['pluginOptions'] != null && self.jobs[func]['pluginOptions'][pluginName] != null){
        var pluginOptions = self.jobs[func]['pluginOptions'][pluginName]
      }else{
        var pluginOptions = {};
      }

      var plugin = null
      if (typeof pluginRefrence === 'string') {
        var pluginConstructor = require(__dirname + "/plugins/" + pluginRefrence + ".js")[pluginRefrence];
        plugin = new pluginConstructor(self, func, queue, job, args, pluginOptions);
      } else if (typeof pluginRefrence === 'function') {
        plugin = new pluginRefrence(self, func, queue, job, args, pluginOptions);
      } else {
        throw new Error('Plugin must be the constructor name or an object');
      }
      
      if(plugin[type] == null || typeof plugin[type] != "function"){
        callback(null, true);
      }else{
        plugin[type](function(err, toRun){
          callback(err, toRun);
        });
      }
    }
  });
}

var runPlugins = function(type, func, queue, job, args, callback, pluginCounter){
  var self = this;
  if(pluginCounter == null){ pluginCounter = 0; }
  if(job == null){
    callback(null, true);
  }else if(job["plugins"] == null || job["plugins"].length == 0){
    callback(null, true);
  }else if(pluginCounter >= job["plugins"].length){
    callback(null, true);
  }else{
    var pluginRefrence = job["plugins"][pluginCounter];
    self.runPlugin(pluginRefrence, type, func, queue, job, args, function(err, toRun){
      pluginCounter++;
      if(toRun === false){
        callback(err, false);
      }else{
        self.runPlugins(type, func, queue, job, args, callback, pluginCounter);
      }
    });
  }
}

exports.runPlugin = runPlugin;
exports.runPlugins = runPlugins;
