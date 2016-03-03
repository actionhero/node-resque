// If the job fails, sleep, and re-enqueue it.
// a port of some of the features in https://github.com/lantins/resque-retry

var crypto = require('crypto');

var retry = function(worker, func, queue, job, args, options){
  var self = this;

  if(!options.retryLimit){ options.retryLimit = 1; }
  if(!options.retryDelay){ options.retryDelay = 1000; }
  if(!options.backoffStrategy){ options.backoffStrategy = null; }

  self.name = 'retry';
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

retry.prototype.retryKey = function(){
  var self = this;
  // TODO: in ruby, the hash is from `args.join('-')`. Does it matter?
  var hash = crypto.createHash('sha1').update(JSON.stringify(self.args)).digest('hex');
  return self.queueObject.connection.key('resque-retry', self.func, hash);
};

retry.prototype.failureKey = function(){
  var self = this;
  var hash = crypto.createHash('sha1').update(self.args.join('-')).digest('hex');
  return self.queueObject.connection.key('failure-', self.func, hash);
};

retry.prototype.redis = function(){
  var self = this;
  return self.queueObject.connection.redis;
};

retry.prototype.attemptUp = function(callback){
  var self = this;
  var key  = self.retryKey();
  self.redis().setnx(key, -1, function(error){
    if(error){ return callback(error); }
    self.redis().incr(key, function(error, retryCount){
      // TODO: expire the key [[ Resque.redis.expire(retry_key, retry_delay + expire_retry_key_after) ]]
      if(error){ return callback(error); }
      var remaning = self.options.retryLimit - retryCount - 1;
      return callback(null, remaning);
    });
  });
};

retry.prototype.saveLastError = function(callback){
  var self = this;
  self.redis().set(self.failureKey(), self.worker.error, callback);
};

retry.prototype.cleanup = function(callback){
  var self = this;
  var key        = self.retryKey();
  var failureKey = self.failureKey();
  self.redis().del(key, function(error){
    if(error){ return callback(error); }
    self.redis().del(failureKey, function(error){
      if(error){ return callback(error); }
      return callback();
    });
  });
};

retry.prototype.after_perform = function(callback){
  var self = this;

  if(!self.worker.error){
    self.clanup(callback);
  }

  self.attemptUp(function(error, remaning){
    if(error){ return callback(error); }
    self.saveLastError(function(error){
      if(error){ return callback(error); }
      if(remaning <= 0){
        self.clanup(function(error){
          if(error){ return callback(error); }
          return callback(self.worker.error, true);
        });
      }else{
        var nextTryDelay = self.options.retryDelay;
        if(Array.isArray(self.options.backoffStrategy)){
          var index = (self.options.retryLimit - remaning - 1);
          if(index > (self.options.backoffStrategy.length - 1)){
            index = (self.options.backoffStrategy.length - 1);
          }
          nextTryDelay = self.options.backoffStrategy[index];
        }

        self.queueObject.enqueueIn(nextTryDelay, self.queue, self.func, self.args, function(error){
          if(error){ return callback(error); }

          self.worker.emit('reEnqueue', self.queue, self.job, {
            delay: nextTryDelay,
            remaningAttempts: remaning,
            err: self.worker.error
          });

          delete self.worker.error;
          return callback(null, true);
        });
      }
    });
  });
};

exports.retry = retry;
