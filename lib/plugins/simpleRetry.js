// If the job fails, sleep, and re-enqueue it.
// You probably never want to use this in production

var simpleRetry = function(worker, func, queue, job, args, options){
  var self = this;
  self.name = 'simpleRetry';
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

  self.sleep = 1000;
  if(self.options.sleep){ self.sleep = self.options.sleep; }
};

////////////////////
// PLUGIN METHODS //
////////////////////


simpleRetry.prototype.after_perform = function(callback){
  // console.log("** after_perform")
  var self = this;

  if(self.worker.error){
    if(self.options.errorCollector){
      self.options.errorCollector.push( self.worker.error );
    }
    self.worker.error = null;
    self.queueObject.enqueueIn(self.sleep, self.queue, self.func, self.args, function(err){
      callback(err, true);
    });
  }else{
    callback(null, true);
  }
};

exports.simpleRetry = simpleRetry;