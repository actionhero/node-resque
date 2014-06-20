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

  self.sleep = 1000;
  if(self.options.sleep != null){ self.sleep = self.options.sleep; }
}

////////////////////
// PLUGIN METHODS //
////////////////////

simpleRetry.prototype.before_enqueue = function(callback){
  // console.log("** before_enqueue")
  callback(null, true);
}

simpleRetry.prototype.after_enqueue = function(callback){
  // console.log("** after_enqueue")
  callback(null, true);
}

simpleRetry.prototype.before_perform = function(callback){
  // console.log("** before_perform")
  callback(null, true);
}

simpleRetry.prototype.after_perform = function(callback){
  // console.log("** after_perform")
  var self = this;

  if(self.worker.error != null){
    if(self.options.errorCollector != null){
      self.options.errorCollector.push( self.worker.error );
    }
    self.worker.error = null;
    setTimeout(function(){
      callback(null, true);
    }, self.sleep)
  }else{
    callback(null, true);
  }
}

exports.simpleRetry = simpleRetry;