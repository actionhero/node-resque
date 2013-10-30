// If a job with the same name, queue, and args is already in the delayed queue(s), do not enqueue it again

var delayQueueLock = function(worker, func, queue, job, args, options){
  var self = this;
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
  var delayedKeyMatcher = self.worker.connection.key('delayed', "*");
  var found = false;
  self.worker.connection.redis.keys(delayedKeyMatcher, function(err, timestamps){
    var started = 0;
    timestamps.forEach(function(timestamp){
      started++;
      self.worker.connection.redis.lrange(timestamp, 0, -1, function(err, jobs){
        for(var i in jobs){
          var job = JSON.parse(jobs[i]);
          if(job.class == self.func && job.queue == self.queue && JSON.stringify(job.args) == JSON.stringify(self.args)){
            found = true;
            break;
          }
        }
        started--;
        if(started == 0){ callback(null, !found); }
      });
    }); 
    if(started == 0){ callback(null, !found); }
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