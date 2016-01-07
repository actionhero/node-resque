// If the job fails, sleep, and re-enqueue it.
// You probably never want to use this in production
var crypto = require('crypto');

var simpleRetry = function(worker, func, queue, job, args, options){
  var self = this;
  self.name = 'simpleRetry';
  self.worker = worker;
  self.queue = queue;
  self.func = func;
  self.job = job;
  self.args = args;
  self.options = options;
  if (! self.options.retryInterval) {
    self.options.retryInterval = [60, 300, 600, 1800, 3600]
  }

  if(self.worker.queueObject){
    self.queueObject = self.worker.queueObject;
  }else{
    self.queueObject = self.worker;
  }

  if (self.args) {
    jobHash = crypto.createHash('md5').update(JSON.stringify(self.args)).digest('hex');
    self.retryKey = self.queueObject.connection.key('retrytimes', jobHash);
  }
};

////////////////////
// PLUGIN METHODS //
////////////////////

simpleRetry.prototype.updateRetryTimes = function(callback) {
  var self = this;

  self.queueObject.connection.redis.incr(self.retryKey, (function(err, result) {
    if (err) { return callback(err); }

    self.queueObject.connection.redis.expire(self.retryKey, self.options.retryInterval[self.options.retryInterval.length - 1] * 2, function(err) {
      if (err) {
        callback(err);
      } else if (result > self.options.retryInterval.length) {
        err.message = '(Resque Retry Max Attempts Reached) -> ' + err.message;
        callback(err);
      } else {
        callback(null, result);
      }
    });
  }));
};

simpleRetry.prototype.deleteRetryTimes = function(callback) {
  this.queueObject.connection.redis.del(this.retryKey, callback);
};

simpleRetry.prototype.after_perform = function(callback){
  var self = this;
  if (self.worker.error) {
    self.updateRetryTimes(function(err, retryTimes) {
      if (err) {
        if (err.message.indexOf('(Resque Retry Max Attempts Reached) -> ') == 0) {
          self.deleteRetryTimes(function(err) {
            return callback(err, true);
          });
        } else {
          return callback(err);
        }
      }

      var delay = self.options.retryInterval[retryTimes - 1];
      self.queueObject.enqueueIn(delay * 1000, self.queue, self.func, self.args, function(err) {
        if (err) { return callback(err); }

        self.worker.emit('reEnqueue', self.queue, self.job, {
          times: retryTimes,
          delay: delay,
          err: self.worker.error
        });
        self.worker.error = null;
        return callback(err, true);
      });
    });
  } else {
    self.deleteRetryTimes(function(err) {
      return callback(err, true);
    });
  };
};

exports.simpleRetry = simpleRetry;
