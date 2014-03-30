// If a job with the same name, queue, and args is already in the queue, do not enqueue it again

var queueLock = function(worker, func, queue, job, args, options){
  var self = this;
  self.name = 'queueLock';
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

queueLock.prototype.before_enqueue = function(callback){
  // console.log("** before_enqueue")
  var self = this;
  var key = self.key();
  var now = Math.round(new Date().getTime() / 1000);
  var timeout = now + self.lock_timeout() + 1;
  self.worker.connection.redis.setnx(key, timeout, function(err, setCallback){
    if(setCallback === true || setCallback === 1){
      callback(null, true);
    }else{
      self.worker.connection.redis.get(key, function(err, redisTimeout){
        redisTimeout = parseInt(redisTimeout);
        if(now <= redisTimeout){
          callback(null, false);
        }else{
          self.worker.connection.redis.set(key, timeout, function(err){
            self.worker.connection.redis.get(key, function(err, redisTimeout){
              redisTimeout = parseInt(redisTimeout);
              callback(null, now > redisTimeout);              
            });
          });
        }
      });
    }
  });
}

queueLock.prototype.after_enqueue = function(callback){
  // console.log("** after_enqueue")
  callback(null, true);
}

queueLock.prototype.before_perform = function(callback){
  // console.log("** before_perform")
  callback(null, true);
}

queueLock.prototype.after_perform = function(callback){
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

queueLock.prototype.lock_timeout = function(){
  var self = this;
  if (self.options.lock_timeout != null){
    return self.options.lock_timeout;
  }else{
    return 3600; // in seconds
  }
}

queueLock.prototype.key = function(){
  var self = this;
  if (self.options.key != null){
    return typeof self.options.key === 'function' ? self.options.key.apply(this) : self.options.key;
  }else{
    var flattenedArgs = JSON.stringify(self.args);
    return self.worker.connection.key('lock', self.func, self.queue, flattenedArgs);
  }
}

exports.queueLock = queueLock;
