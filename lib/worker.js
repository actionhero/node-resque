var os = require("os");
var util = require("util");
var exec = require('child_process').exec;
var domain = require('domain');
var EventEmitter = require('events').EventEmitter;
var connection   = require(__dirname + "/connection.js").connection;
var queue        = require(__dirname + "/queue.js").queue;
var pluginRunner = require(__dirname + "/pluginRunner.js");

var worker = function(options, jobs, callback){
  var self = this;
  var defaults = self.defaults();
  for(var i in defaults){
    if(options[i] == null){
      options[i] = defaults[i];
    }
  }
  self.options = options;
  self.jobs = jobs;
  self.name = self.options.name;
  self.queues = self.options.queues;
  self.ready = false;
  self.running = false;
  self.working = false;
  self.job = null;
  self.activePlugins = [];

  self.runPlugin  = pluginRunner.runPlugin
  self.runPlugins = pluginRunner.runPlugins

  self.queueObject = new queue({connection: options.connection}, function(){
    self.connection = self.queueObject.connection;
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
    self.untrack(self.name, self.stringQueues(), function(){
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
    if(typeof callback == 'function'){ callback(); }
  }else{
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
  }
};

worker.prototype.perform = function(job, callback) {
  var self = this;
  var d = domain.create();
  d.on('error', function(err){
    self.completeJob(null, err, callback);
  });
  d.run(function(){
    try{
      if (self.jobs[job["class"]] == null){ throw new Error("No job defined for class '"+job["class"]+"'") }
      var cb = self.jobs[job["class"]]["perform"];
      self.emit('job', self.queue, job);
      if (cb != null) {    
        self.working = true;
        self.job = job;
        self.runPlugins('before_perform', job["class"], self.queue, self.jobs[job["class"]], job.args, function(err, toRun){
          if(toRun == false){
            self.completeJob(null, null, callback);
          }else{
            self.workingOn(job);
            if(job.args == null || (job.args instanceof Array) === true){
              var args = job.args;
            }else{
              var args = [job.args];
            }
            cb.apply(null, [].slice.call(args).concat([function(result) {
              self.runPlugins('after_perform', job["class"], self.queue, self.jobs[job["class"]], job.args, function(err, toRun){
                if (result instanceof Error) {
                  self.completeJob(null, result, callback);
                } else {
                  self.completeJob(result, null, callback);
                }
              });
            }]));
          }
        });      
      } else {
        self.completeJob(null, "Missing Job: " + job["class"], callback);
      }
    }catch(err){
      d.emit('error', err);
    }
  });
};

worker.prototype.completeJob = function(result, err, callback){
  var self = this;
  var job = self.job;

  var onComplete = function(){
    if(err != null){
      self.fail(err, job);
    }else if(result != null){
      self.succeed(result, job);
    }
    self.doneWorking();
    self.job = null;
    self.activePlugins = [];
    process.nextTick((function() {
      if(self.options.looping){
        return self.poll();
      }else{
        callback();
      }
    }));
  }

  if(self.activePlugins.length === 0){
    onComplete(); 
  }else{
    var completedCallbacks = 0;
    self.activePlugins.forEach(function(plugin){
      if(typeof plugin.jobComplete == 'function'){
        plugin.jobComplete(function(){
          completedCallbacks++;
          if(self.activePlugins.length == completedCallbacks){
            onComplete();
          }
        });
      }else{
        completedCallbacks++;
        if(self.activePlugins.length == completedCallbacks){
          onComplete();
        }
      }
    });
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
  self.connection.redis.set(self.connection.key('worker', self.name, self.stringQueues()), JSON.stringify({
    run_at: (new Date).toString(),
    queue: self.queue,
    payload: job
  }));
};

worker.prototype.doneWorking = function() {
  var self = this;
  self.working = false;
  self.connection.redis.del(self.connection.key('worker', self.name, self.stringQueues()));
};

worker.prototype.track = function(callback) {
  var self = this;
  self.running = true;
  self.connection.redis.sadd(self.connection.key('workers'), (self.name + ":" + self.stringQueues()), function(){
    if(typeof callback == "function"){ callback(); }
  });
};

worker.prototype.untrack = function(name, queues, callback) {
  var self = this;
  self.connection.redis.srem(self.connection.key('workers'), (name + ":" + queues), function(){
    self.connection.redis.del([
      self.connection.key('worker', name, self.stringQueues()), 
      self.connection.key('worker', name, self.stringQueues(), 'started'), 
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
  self.connection.redis.set(self.connection.key('worker', self.name, self.stringQueues(), 'started'), (new Date).toString(), function(){
    if(typeof callback == "function"){ callback(); }
  });
};

worker.prototype.workerCleanup = function(callback){
  var self = this;
  self.getPids(function(err, pids){
    self.connection.redis.smembers(self.connection.key('workers'), function(err, workers){
      workers.forEach(function(w){
        var parts = w.split(":");
        var host = parts[0]; var pid = parseInt(parts[1]); var queues = parseInt(parts[2]);
        if(host === os.hostname() && pids.indexOf(pid) < 0){
          (function(w){
            self.emit("cleaning_worker", w, pid);
            var parts = w.split(":");
            var queues = parts.splice(-1, 1);
            var pureName = parts.join(':') 
            self.untrack(pureName, queues);
          })(w)
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
  if (typeof self.queues == "string"){
    self.queues = [self.queues];
  }
  if (self.ready === true && self.queues.length > 0 && self.queues.shift != null) {
    return;
  }
  if (( self.queues[0] === '*' && self.queues.length == 1 ) || self.queues.length === 0 ) {
    self.originalQueue = "*";
    self.untrack(self.name, self.stringQueues(), function(){
      self.connection.redis.smembers(self.connection.key('queues'), function(err, resp) {
        self.queues = resp ? resp.sort() : [];
        self.track(function(){
          self.ready = true;
          if(typeof callback == "function"){ callback(); }
        });
      });
    });
  }else{
    if(self.queues instanceof String){ self.queues = self.queues.split(','); }
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

worker.prototype.stringQueues = function(){
  var self = this;
  if(self.queues.length == 0){
    return ["*"].join(",");
  }else{
    return self.queues.join(',');
  }
}

exports.worker = worker;