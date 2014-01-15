// If a job with the same name, queue, and args is already in the delayed queue(s), do not enqueue it again

var delayQueueLock = function(worker, func, queue, job, args, options){
  var self = this;
  self.name = 'delayQueueLock';
  self.worker = worker;
  self.queue = queue;
  self.func = func;
  self.job = job;
  self.args = args;
  self.options = options;
}

////////////////////
// PLUGIN METHODS //
////////////////////

delayQueueLock.prototype.before_enqueue = function(callback){
  // console.log("** before_enqueue")
  var self = this;
  self.worker.queueObject.scheduledAt(self.queue, self.func, self.args, function(err, timestamps){
    if(timestamps.length > 0){
      callback(null, false); 
    }else{
      callback(null, true); 
    }
  });
}

delayQueueLock.prototype.after_enqueue = function(callback){
  // console.log("** after_enqueue")
  callback(null, true);
}

delayQueueLock.prototype.before_perform = function(callback){
  // console.log("** before_perform")
  callback(null, true);
}

delayQueueLock.prototype.after_perform = function(callback){
  // console.log("** after_perform")
  callback(null, true);
}

exports.delayQueueLock = delayQueueLock;