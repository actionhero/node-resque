var runPlugin = function(self, pluginRefrence, type, func, queue, job, args, callback){
  process.nextTick(function(){
    if(!job){
      callback(null, true);
    }else{

      var pluginName = pluginRefrence;
      if(typeof pluginRefrence === 'function'){
        pluginName = new pluginRefrence(self, func, queue, job, args, {}).name;
      }

      var pluginOptions = null;
      if(self.jobs[func].pluginOptions && self.jobs[func].pluginOptions[pluginName]){
        pluginOptions = self.jobs[func].pluginOptions[pluginName];
      }else{
        pluginOptions = {};
      }

      var plugin = null;
      if(typeof pluginRefrence === 'string'){
        var pluginConstructor = require(__dirname + '/plugins/' + pluginRefrence + '.js')[pluginRefrence];
        plugin = new pluginConstructor(self, func, queue, job, args, pluginOptions);
      }else if(typeof pluginRefrence === 'function'){
        plugin = new pluginRefrence(self, func, queue, job, args, pluginOptions);
      }else{
        throw new Error('Plugin must be the constructor name or an object');
      }

      if(plugin[type] === null || plugin[type] === undefined  || typeof plugin[type] !== 'function'){
        callback(null, true);
      }else{
        plugin[type](function(err, toRun){
          callback(err, toRun);
        });
      }
    }
  });
};

var runPlugins = function(self, type, func, queue, job, args, callback, pluginCounter){
  if(!pluginCounter){ pluginCounter = 0; }
  if(!job){
    callback(null, true);
  }else if(job.plugins === null || job.plugins === undefined || job.plugins.length === 0){
    callback(null, true);
  }else if(pluginCounter >= job.plugins.length){
    callback(null, true);
  }else{
    var pluginRefrence = job.plugins[pluginCounter];
    runPlugin(self, pluginRefrence, type, func, queue, job, args, function(err, toRun){
      pluginCounter++;
      if(err){
        callback(err, toRun);
      }else if(toRun === false){
        callback(err, false);
      }else{
        runPlugins(self, type, func, queue, job, args, callback, pluginCounter);
      }
    });
  }
};

exports.runPlugin = runPlugin;
exports.runPlugins = runPlugins;
