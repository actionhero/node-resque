// Simple plugin to prevent all jobs
var CustomPlugin = function(worker, func, queue, job, args, options){
  var self = this;
  self.name = 'CustomPlugin';
  self.worker = worker;
  self.queue = queue;
  self.func = func;
  self.job = job;
  self.args = args;
  self.options = options;
};

CustomPlugin.prototype.before_enqueue = function(callback){
  callback(null, false);
};

CustomPlugin.prototype.after_enqueue = function(callback){
  callback(null, false);
};

CustomPlugin.prototype.before_perform = function(callback){
  callback(null, false);
};

CustomPlugin.prototype.after_perform = function(callback){
  callback(null, false);
};

module.exports = CustomPlugin;
