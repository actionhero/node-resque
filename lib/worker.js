var os = require("os");
var util = require("util");
var exec = require('child_process').exec;
var domain = require('domain');
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
    self.working = false;
    self.checkQueues(function(){
      if(typeof callback == 'function'){ callback(); }
    });
  });
}

util.inherits(worker, EventEmitter);

worker.prototype.defaults = function(){
  var self = this;
  return {
    name:      os.hostname() + ":" + process.pid, // assumes only one worker per node process
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
  if (self.working == true){
    setTimeout(function(){
      self.end(callback);
    }, self.options.timeout);
  }else{
    self.emit('end');
    self.untrack(self.name, function(){
      if(typeof callback == "function"){ callback(); }
    });
  }
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
          process.nextTick(function() {
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
  var cb = self.callbacks[job["class"]];
  self.emit('job', self.queue, job);
  if (cb != null) {
    var d = domain.create();
    d.on('error', function(er){
      self.fail(new Error(er), job);
      self.doneWorking();
      process.nextTick((function() {
        if(self.options.looping){
          return self.poll();
        }else{
          callback();
        }
      }));
    });
    d.run(function(){
      self.working = true;
      self.workingOn(job);
      job.queue = self.queue;
      cb.call(null, job, function(result) {
        try {
          if (result instanceof Error) {
            self.fail(result, job);
          } else {
            self.succeed(result, job);
          }
        } finally {
          self.doneWorking();
          process.nextTick((function() {
            if(self.options.looping){
              self.poll();
            }else{
              callback();
            }
          }));
        }
      });
    });
  } else {
    self.fail(new Error("Missing Job: " + job["class"]), job);
    process.nextTick((function() {
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
  self.working = false;
  return self.connection.redis.del(self.connection.key('worker', self.name));
};

worker.prototype.track = function(callback) {
  var self = this;
  self.running = true;
  self.connection.redis.sadd(self.connection.key('workers'), self.name, function(){
    if(typeof callback == "function"){ callback(); }
  });
};

worker.prototype.untrack = function(name, callback) {
  var self = this;
  self.connection.redis.srem(self.connection.key('workers'), name, function(){
    self.connection.redis.del([
      self.connection.key('worker', name), 
      self.connection.key('worker', name, 'started'), 
      self.connection.key('stat', 'failed', name), 
      self.connection.key('stat', 'processed', name)
    ], function(err){
      if(typeof callback == "function"){ callback(err); }
    });
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

worker.prototype.workerCleanup = function(callback){
  var self = this;
  self.getPids(function(err, pids){
    self.connection.redis.smembers(self.connection.key('workers'), function(err, workers){
      workers.forEach(function(w){
        var parts = w.split(":");
        var host = parts[0]; var pid = parseInt(parts[1]);
        if(host === os.hostname() && pids.indexOf(pid) < 0){
          self.emit("cleaning_worker", w, pid);
          self.untrack(w);
        }
      });
      if(typeof callback == "function"){ callback(); }
    });
  });
}

worker.prototype.getPids = function(callback){
  var child = exec('ps awx | grep -v grep', function(error, stdout, stderr){
    var pids = [];
    stdout.split("\n").forEach(function(line){
      line = line.trim();
      if(line.length > 0){
        var pid = parseInt(line.split(' ')[0]);
        pids.push(pid);
      }
    });
    callback(error, pids);
  });
}

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