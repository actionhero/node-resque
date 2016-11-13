// If a job fails, retry it N times before finally placing it into the failed queue
// a port of some of the features in https://github.com/lantins/resque-retry

var crypto = require('crypto');
var os     = require('os');

var retry = function(worker, func, queue, job, args, options){
  var self = this;

  if(!options.retryLimit){ options.retryLimit = 1; }
  if(!options.retryDelay){ options.retryDelay = (1000 * 5); }
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

retry.prototype.argsKey = function(){
  var self = this;
  // return crypto.createHash('sha1').update(self.args.join('-')).digest('hex');
  if(!self.args || self.args.length === 0){ return ''; }
  return self.args.map(function(elem){
    return typeof(elem) === "object" ? JSON.stringify(elem) : elem;
  }).join("-");
};

retry.prototype.retryKey = function(){
  var self = this;
  return self.queueObject.connection.key('resque-retry', self.func, self.argsKey()).replace(/\s/, '');
};

retry.prototype.failureKey = function(){
  var self = this;
  return self.queueObject.connection.key('failure-resque-retry:' + self.func + ':' + self.argsKey()).replace(/\s/, '');
};

retry.prototype.maxDelay = function(){
  var self = this;
  var maxDelay = self.options.retryDelay || 1;
  if(Array.isArray(self.options.backoffStrategy)){
    self.options.backoffStrategy.forEach(function(d){
      if(d > maxDelay){ maxDelay = d; }
    });
  }
  return maxDelay;
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
      if(error){ return callback(error); }
      self.redis().expire(key, self.maxDelay(), function(error){
        if(error){ return callback(error); }
        var remaning = self.options.retryLimit - retryCount - 1;
        return callback(null, remaning);
      });
    });
  });
};

retry.prototype.saveLastError = function(callback){
  var self = this;
  var now  = new Date();
  var failedAt = '' +
    now.getFullYear() + '/' +
    (('0' + (now.getMonth() + 1)).slice(-2)) + '/' +
    (('0' + now.getDate()).slice(-2)) + ' ' +
    (('0' + now.getHours()).slice(-2)) + ':' +
    (('0' + now.getMinutes()).slice(-2)) + ':' +
    (('0' + now.getSeconds()).slice(-2))
    ;

  var data = {
    failed_at : failedAt,
    payload   : self.args,
    exception : String(self.worker.error),
    error     : String(self.worker.error),
    backtrace : self.worker.error.stack.split(os.EOL) || [],
    worker    : self.func,
    queue     : self.queue
  };

  self.redis().setex(self.failureKey(), self.maxDelay(), JSON.stringify(data), callback);
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
    return self.cleanup(callback);
  }

  self.attemptUp(function(error, remaning){
    if(error){ return callback(error); }
    self.saveLastError(function(error){
      if(error){ return callback(error); }
      if(remaning <= 0){
        self.cleanup(function(error){
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

          self.redis().decr(self.queueObject.connection.key('stat', 'processed'));
          self.redis().decr(self.queueObject.connection.key('stat', 'processed', self.worker.name));

          self.redis().incr(self.queueObject.connection.key('stat', 'failed'));
          self.redis().incr(self.queueObject.connection.key('stat', 'failed', self.worker.name));

          delete self.worker.error;
          return callback(null, true);
        });
      }
    });
  });
};

exports.retry = retry;
