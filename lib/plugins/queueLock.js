// If a job with the same name, queue, and args is already in the queue, do not enqueue it again

var os = require("os");

var queueLock = function(worker, func, queue, job, args, options){
  var self = this;
  self.name = 'queueLock';
  self.worker = worker;
  self.queue = queue;
  self.func = func;
  self.job = job;
  self.args = args;
  self.options = options;
  self.uniqueId = os.hostname() + process.pid + new Date().getTime(); //also can use "uuid" node_module

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
  var lockTimeout = self.lock_timeout(); //in seconds
  self.uniqueId = os.hostname() + process.pid + new Date().getTime();
  //setnx && expire
  self.queueObject.connection.redis.set(key, self.uniqueId, 'NX', 'PX', lockTimeout * 1000, function(err, setCallback){
    if(err){ return callback(err); }
    if(setCallback !== null){
      callback(null, true);
    }else{
      callback(null, false);
    }
  });
};

queueLock.prototype.after_perform = function(callback){
  // console.log("** after_perform")
  var self = this;
  var key = self.key();
  var redis = self.queueObject.connection.redis;
  // redis pkg must have "watch", "multi", "exec" func (eg: "ioredis")
  redis.watch(key).then(function(){
    redis.get(key, function(err, uniqueId){
      if(err){ return callback(err, true); }
      if(self.uniqueId.toString() !== uniqueId){
        return callback(null, true);  //don't unlock
      }else{
        redis.multi().del(key).exec(function(err/*, result*/){
          if(err){ return callback(err, true); }
          // if(result === null){ console.log("** unlock fail"); }
          callback(null, true);
        })
      }
    })
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
