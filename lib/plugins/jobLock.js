// If a job with the same name, queue, and args is already running, put this job back in the queue and try later

var jobLock = function(worker, func, queue, job, args, options){
  var self = this;
  self.name = 'jobLock';
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

jobLock.prototype.before_enqueue = function(callback){
  // console.log("** before_enqueue")
  callback(null, true);
}

jobLock.prototype.after_enqueue = function(callback){
  // console.log("** after_enqueue")
  callback(null, true);
}

jobLock.prototype.before_perform = function(callback){
  // console.log("** before_perform")
  var self = this;
  var key = self.key();
  var now = Math.round(new Date().getTime() / 1000);
  var timeout = now + self.lock_timeout() + 1;
  self.worker.connection.redis.setnx(key, timeout, function(err, setCallback){
    if(setCallback === true || setCallback === 1){
      self.worker.connection.redis.expire(key, self.lock_timeout());
      callback(null, true);
    }else{
      self.reEnqueue(function(){
        callback(null, false);
      });
    }
  });
}

jobLock.prototype.after_perform = function(callback){
  // console.log("** after_perform")
  var self = this;
  var key = self.key();
  self.worker.connection.redis.del(key, function(err){
    callback(null, true);
  });
}

/////////////
// HELPERS //
/////////////

jobLock.prototype.reEnqueue = function(callback){
  var self = this;
  setTimeout(function(){
    self.worker.queueObject.enqueue(self.queue, self.func, self.args, function(){
      callback();
    });
  }, self.enqueue_timeout() );
}

jobLock.prototype.lock_timeout = function(){
  var self = this;
  if (self.options.lock_timeout != null){
    return self.options.lock_timeout;
  }else{
    return 3600; // in seconds
  }
}

jobLock.prototype.enqueue_timeout = function(){
  var self = this;
  if (self.options.enqueue_timeout != null){
    return self.options.enqueue_timeout;
  }else{
    return 1001; // in ms
  }
}

jobLock.prototype.key = function(){
  var self = this;
  if (self.options.key != null){
    return typeof self.options.key === 'function' ? self.options.key.apply(this) : self.options.key;
  }else{
    var flattenedArgs = JSON.stringify(self.args);
    return self.worker.connection.key('workerslock', self.func, self.queue, flattenedArgs);
  }
}

exports.jobLock = jobLock;
