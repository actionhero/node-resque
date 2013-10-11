
var runPlugin = function(pluginName, type, jobName, job, args, callback){
  var self = this;
  process.nextTick(function(){
    if(job == null){
      callback(null, true);
    }else{
      var pluginOptions = self.jobs[jobName]['pluginOptions'];
      var pluginConstructor = require(__dirname + "/plugins/" + pluginName + ".js")[pluginName];
      var plugin = new pluginConstructor(self, job, args, pluginOptions);
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

var runPlugins = function(type, jobName, job, args, callback, pluginCounter){
  var self = this;
  if(pluginCounter == null){ pluginCounter = 0; }
  if(job == null){
    callback(null, true);
  }else if(job["plugins"] == null || job["plugins"].length == 0){
    callback(null, true);
  }else if(pluginCounter >= job["plugins"].length){
    callback(null, true);
  }else{
    var pluginName = job["plugins"][pluginCounter];
    self.runPlugin(pluginName, type, jobName, job, args, function(err, toRun){
      pluginCounter++;
      if(toRun === false){
        callback(err, false);
      }else{
        self.runPlugins(type, jobName, job, args, callback, pluginCounter);
      }
    });
  }
}

exports.runPlugin = runPlugin;
exports.runPlugins = runPlugins;