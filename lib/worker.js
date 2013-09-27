var os = require("os");
var util = require("util");
var EventEmitter = require('events').EventEmitter;
var connection = require(__dirname + "/connection.js").connection;

var worker = function(options, callbacks, callback){
  var self = this;
  var defaults = self.defaults();
  for(var i in defaults){
    if(options[i] == null){
      options[i] = defaults[i];
    }
  }
  self.options = options;
  self.callbacks = callbacks;
  self.name = self.options.name;
  self.queues = self.options.queues;
  self.connection = new connection(options.connection);
  self.connection.connect(function(){
    self.ready = false;
    self.running = false;
    self.checkQueues(function(){
      if(typeof callback == 'function'){ callback(); }
    });
  });
}

util.inherits(worker, EventEmitter);

worker.prototype.defaults = function(){
  var self = this;
  return {
    name:      os.hostname() + ":" + process.pid,
    queues:    "*",
    timeout:   5000,
    looping:   true,
  }
}

worker.prototype.start = function() {
  var self = this;
  if(self.ready){
    self.emit('start');
    self.init(function(){
      self.poll();
    });
  }
};

worker.prototype.end = function(callback) {
  var self = this;
  self.running = false;
  self.emit('end');
  self.untrack(function(){
    self.connection.redis.del([
      self.connection.key('worker', self.name), 
      self.connection.key('worker', self.name, 'started'), 
      self.connection.key('stat', 'failed', self.name), 
      self.connection.key('stat', 'processed', self.name)
    ], function(err){
      if(typeof callback == "function"){
        callback();
      }
    });
  });
};

worker.prototype.poll = function(nQueue, callback) {
  var self = this;
  if (nQueue == null) {
    nQueue = 0;
  }
  if (!self.running) {
    callback();
  }
  self.queue = self.queues[nQueue];
  self.emit('poll', self.queue);
  if(self.queue == null){
    self.checkQueues(function(){
      self.pause();
    });
  }else{
    self.connection.redis.lpop(self.connection.key('queue', self.queue), function(err, resp) {
      if (!err && resp) {
        var currentJob = JSON.parse(resp.toString());
        if(self.options.looping){
          self.perform(currentJob);
        }else{
          callback(currentJob);
        }
      } else {
        if (nQueue === self.queues.length - 1) {
          return process.nextTick(function() {
            if(self.options.looping){
              self.pause();
            }else{
              callback();
            }
          });
        } else {
          process.nextTick(function() {
            self.poll(nQueue + 1);
          });
        }
      }
    });
  }
};

worker.prototype.perform = function(job, callback) {
  var self = this;
  var cb;
  self.emit('job', self.queue, job);
  if (cb = self.callbacks[job["class"]]) {
    self.workingOn(job);
    try {
      return cb.apply(null, [].slice.call(job.args).concat([function(result) {
        try {
          if (result instanceof Error) {
            return self.fail(result, job);
          } else {
            return self.succeed(result, job);
          }
        } finally {
          self.doneWorking();
          process.nextTick((function() {
            if(self.options.looping){
              return self.poll();
            }else{
              callback();
            }
          }));
        }
      }]));
    } catch (error) {
      self.fail(new Error(error), job);
      self.doneWorking();
      return process.nextTick((function() {
        if(self.options.looping){
          return self.poll();
        }else{
          callback();
        }
      }));
    }
  } else {
    self.fail(new Error("Missing Job: " + job["class"]), job);
    return process.nextTick((function() {
      if(self.options.looping){
        return self.poll();
      }else{
        callback();
      }
    }));
  }
};

worker.prototype.succeed = function(result, job) {
  var self = this;
  self.connection.redis.incr(self.connection.key('stat', 'processed'));
  self.connection.redis.incr(self.connection.key('stat', 'processed', self.name));
  self.emit('success', self.queue, job, result);
};

worker.prototype.fail = function(err, job) {
  var self = this;
  self.connection.redis.incr(self.connection.key('stat', 'failed'));
  self.connection.redis.incr(self.connection.key('stat', 'failed', self.name));
  self.connection.redis.rpush(self.connection.key('failed'), JSON.stringify(self.failurePayload(err, job)));
  self.emit('error', self.queue, job, err);
};

worker.prototype.pause = function() {
  var self = this;
  self.emit('pause');
  setTimeout(function() {
    if (!self.running) {
      return;
    }
    self.poll();
  }, self.options.timeout);
};

worker.prototype.workingOn = function(job) {
  var self = this;
  return self.connection.redis.set(self.connection.key('worker', self.name), JSON.stringify({
    run_at: (new Date).toString(),
    queue: self.queue,
    payload: job
  }));
};

worker.prototype.doneWorking = function() {
  var self = this;
  return self.connection.redis.del(self.connection.key('worker', self.name));
};

worker.prototype.track = function(callback) {
  var self = this;
  self.running = true;
  self.connection.redis.sadd(self.connection.key('workers'), self.name, function(){
    if(typeof callback == "function"){ callback(); }
  });
};

worker.prototype.untrack = function(callback) {
  var self = this;
  self.connection.redis.srem(self.connection.key('workers'), self.name, function(){
    if(typeof callback == "function"){ callback(); }
  });
};

worker.prototype.init = function(callback) {
  var self = this;
  var args, _ref;
  self.track();
  self.connection.redis.set(self.connection.key('worker', self.name, 'started'), (new Date).toString(), function(){
    if(typeof callback == "function"){ callback(); }
  });
};

worker.prototype.checkQueues = function(callback){
  var self = this;
  if (self.queues.length > 0 && self.queues.shift != null) {
    return;
  }
  if (self.queues === '*' || self.queues.length === 0) {
    return self.connection.redis.smembers(self.connection.key('queues'), function(err, resp) {
      self.queues = resp ? resp.sort() : [];
      self.ready = true;
      if(typeof callback == "function"){ callback(); }
    })
  }else{
    self.queues = self.queues.split(',');
    self.ready = true;
    if(typeof callback == "function"){ callback(); }
  }
};

worker.prototype.failurePayload = function(err, job) {
  var self = this;
  return {
    worker: self.name,
    queue: self.queue,
    payload: job,
    exception: err.name,
    error: err.message,
    backtrace: err.stack.split('\n').slice(1),
    failed_at: (new Date).toString()
  };
};

exports.worker = worker;