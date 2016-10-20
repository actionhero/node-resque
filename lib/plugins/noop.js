var noop = function(worker, func, queue, job, args, options){
  var self = this;
  self.name = 'noop';
  self.worker = worker;
  self.queue = queue;
  self.func = func;
  self.job = job;
  self.args = args;
  self.options = options;

  if(self.worker.queueObject){
    self.queueObject = self.worker.queueObject;
  }else{
    self.queueObject = self.worker;
  }
};

noop.prototype.after_perform = function(callback){
  var self = this;
  if(self.worker.error){
    if(typeof self.options.logger === 'function'){
      self.options.logger(self.worker.error);
    } else{
      console.log(self.worker.error);
    }
    delete self.worker.error;
  }

  callback(null, true);
};

exports.noop = noop;
