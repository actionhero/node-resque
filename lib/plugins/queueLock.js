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

  if(self.worker.queueObject){
    self.queueObject = self.worker.queueObject;
  }else{
    self.queueObject = self.worker;
  }
};

////////////////////
// PLUGIN METHODS //
////////////////////

queueLock.prototype.before_enqueue = function(callback){
  // console.log("** before_enqueue")
  var self = this;
  var key = self.key();
  var now = Math.round(new Date().getTime() / 1000);
  var timeout = now + self.lock_timeout() + 1;
  self.queueObject.connection.redis.setnx(key, timeout, function(err, setCallback){
    if(err){ return callback(err); }
    if(setCallback === true || setCallback === 1){
      callback(null, true);
    }else{
      self.queueObject.connection.redis.get(key, function(err, redisTimeout){
        if(err){ return callback(err); }
        redisTimeout = parseInt(redisTimeout);
        if(now <= redisTimeout){
          callback(null, false);
        }else{
          self.queueObject.connection.redis.set(key, timeout, function(err){
            self.queueObject.connection.redis.expire(key, timeout);
            callback(err, !err);
          });
        }
      });
    }
  });
};

queueLock.prototype.after_perform = function(callback){
  // console.log("** after_perform")
  var self = this;
  var key = self.key();
  self.queueObject.connection.redis.del(key, function(err){
    callback(err, true);
  });
};

/////////////
// HELPERS //
/////////////

queueLock.prototype.lock_timeout = function(){
  var self = this;
  if (self.options.lock_timeout){
    return self.options.lock_timeout;
  }else{
    return 3600; // in seconds
  }
};

queueLock.prototype.key = function(){
  var self = this;
  if (self.options.key){
    return typeof self.options.key === 'function' ? self.options.key.apply(this) : self.options.key;
  }else{
    var flattenedArgs = JSON.stringify(self.args);
    return self.queueObject.connection.key('lock', self.func, self.queue, flattenedArgs);
  }
};

exports.queueLock = queueLock;
