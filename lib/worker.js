var os = require("os");
var util = require("util");
var exec = require('child_process').exec;
var domain = require('domain');
var EventEmitter = require('events').EventEmitter;
var connection   = require(__dirname + "/connection.js").connection;
var queue        = require(__dirname + "/queue.js").queue;
var pluginRunner = require(__dirname + "/pluginRunner.js");
var getCallback  = require(__dirname + "/callback.js");

var worker = function(options, jobs){
  var self = this;
  if(!jobs){ jobs = {}; }

  var defaults = self.defaults();
  for(var i in defaults){
    if(options[i] === undefined || options[i] === null){
      options[i] = defaults[i];
    }
  }

  self.options = options;
  self.jobs = prepareJobs(jobs);
  self.name = self.options.name;
  self.queues = self.options.queues;
  self.error = null;
  self.ready = false;
  self.running = false;
  self.working = false;
  self.job = null;

  self.queueObject = new queue({connection: options.connection}, self.jobs);

  self.queueObject.on('error', function(err){
    self.emit('error', err);
  });
};

util.inherits(worker, EventEmitter);

worker.prototype.defaults = function(){
  var self = this;
  return {
    name:      os.hostname() + ":" + process.pid, // assumes only one worker per node process
    queues:    "*",
    timeout:   5000,
    looping:   true,
  };
};

worker.prototype.connect = function(callback){
  callback = getCallback(callback);
  var self = this;
  self.queueObject.connect(function(){
    self.connection = self.queueObject.connection;
    self.checkQueues(function(){
      if(typeof callback === 'function'){ callback(); }
    });
  });
};

worker.prototype.start = function(callback) {
  callback = getCallback(callback);
  var self = this;
  if(self.ready){
    self.emit('start');
    callback();
    self.init(function(){
      self.poll();
    });
  }
};

worker.prototype.end = function(callback) {
  callback = getCallback(callback);
  var self = this;
  self.running = false;
  if (self.working === true){
    setTimeout(function(){
      self.end(callback);
    }, self.options.timeout);
  }else{
    self.untrack(self.name, self.stringQueues(), function(){
      self.queueObject.end(function() {
        self.emit('end');
        callback();
      });
    });
  }
};

worker.prototype.poll = function(nQueue, callback) {
  callback = getCallback(callback);
  var self = this;
  if (nQueue === null || nQueue === undefined) {
    nQueue = 0;
  }
  if (!self.running) {
    callback();
  }else{
    self.queue = self.queues[nQueue];
    self.emit('poll', self.queue);
    if(self.queue === null || self.queue === undefined){
      self.checkQueues(function(){
        self.pause();
      });
    }else if(self.working === true){
      var err = new Error('refusing to get new job, already working');
      self.emit('error', self.queue, null, err);
    }else{
      self.working = true;
      self.connection.redis.lpop(self.connection.key('queue', self.queue), function(err, resp){
        if(!err && resp){
          var currentJob = JSON.parse(resp.toString());
          if(self.options.looping){
            self.perform(currentJob);
          }else{
            callback(currentJob);
          }
        }else{
          if(err){
            self.emit('error', self.queue, null, err);
          }
          self.working = false;
          if(nQueue === self.queues.length - 1){
            process.nextTick(function() {
              if(self.options.looping){
                self.pause();
              }else{
                callback();
              }
            });
          }else{
            process.nextTick(function(){
              self.poll(nQueue + 1, callback);
            });
          }
        }
      });
    }
  }
};

worker.prototype.perform = function(job, callback) {
  callback = getCallback(callback);
  var self = this;
  var d = domain.create();
  self.job = job;
  d.on('error', function(err){
    self.error = err;
    self.completeJob(null, true, callback);
  });
  d.run(function(){
    self.error = null;
    if (!self.jobs[job["class"]]){
      self.error = new Error("No job defined for class '"+job["class"]+"'");
      self.completeJob(null, true, callback);
    }else{
      var cb = self.jobs[job["class"]].perform;
      self.emit('job', self.queue, job);
      if(cb) {
        var returnCounter = 0; // a state counter to prevent multiple returns from poor jobs or plugins
        var callbackError = new Error('refusing to continue with job, multiple callbacks detected');
        pluginRunner.runPlugins(self, 'before_perform', job["class"], self.queue, self.jobs[job["class"]], job.args, function(err, toRun){
          returnCounter++;
          if(returnCounter !== 1){
            self.emit('failure', self.queue, job, callbackError);
          }else if(toRun === false){
            self.completeJob(null, false, callback);
          }else{
            self.error = err;
            self.workingOn(job);
            var args;
            if(job.args === undefined || (job.args instanceof Array) === true){
              args = job.args;
            }else{
              args = [job.args];
            }

            var combinedInputs = [].slice.call(args).concat([function(err, result){
              returnCounter++;
              if(returnCounter !== 2){
                self.emit('failure', self.queue, job, callbackError);
              }else{
                self.error = err;
                pluginRunner.runPlugins(self, 'after_perform', job["class"], self.queue, self.jobs[job["class"]], job.args, function(e, toRun){
                  if(self.error === undefined && e){ self.error = e; }
                  returnCounter++;
                  if(returnCounter !== 3){
                    self.emit('failure', self.queue, job, callbackError);
                  }else{
                    self.completeJob(result, true, callback);
                  }
                });
              }
            }]);

            // When returning the payload back to redis (on error), it is important that the orignal payload is preserved
            // To help with this, we can stry to make the inputs to the job immutible
            // https://github.com/taskrabbit/node-resque/issues/99
            // Note: if an input is a string or a number, you CANNOT freeze it saddly.
            for(var i in combinedInputs){
              if((typeof combinedInputs[i] === 'object') && (combinedInputs[i] !== null)){
                Object.freeze(combinedInputs[i]);
              }
            }

            cb.apply(self, combinedInputs);
          }
        });
      }else{
        self.error = new Error("Missing Job: " + job["class"]);
        self.completeJob(null, true, callback);
      }
    }
  });
};

worker.prototype.completeJob = function(result, toRespond, callback){
  callback = getCallback(callback);
  var self = this;
  var job = self.job;
  if(self.error){
    self.fail(self.error, job);
  }else if(toRespond){
    self.succeed(result, job);
  }
  self.doneWorking();
  self.job = null;
  process.nextTick((function() {
    if(self.options.looping){
      return self.poll();
    }else{
      callback();
    }
  }));
};

worker.prototype.succeed = function(result, job, callback) {
  callback = getCallback(callback);
  var self = this;
  self.connection.redis.incr(self.connection.key('stat', 'processed'));
  self.connection.redis.incr(self.connection.key('stat', 'processed', self.name));
  self.emit('success', self.queue, job, result);
  callback(null, self.queue, job, result);
};

worker.prototype.fail = function(err, job, callback) {
  callback = getCallback(callback);
  var self = this;
  self.connection.redis.incr(self.connection.key('stat', 'failed'));
  self.connection.redis.incr(self.connection.key('stat', 'failed', self.name));
  self.connection.redis.rpush(self.connection.key('failed'), JSON.stringify(self.failurePayload(err, job)), function(){
    self.emit('failure', self.queue, job, err);
    callback(null, self.queue, job, err);
  });
};

worker.prototype.pause = function(callback) {
  callback = getCallback(callback);
  var self = this;
  self.emit('pause');
  callback();
  setTimeout(function() {
    if (!self.running) {
      return;
    }
    self.poll();
  }, self.options.timeout);
};

worker.prototype.workingOn = function(job, callback) {
  callback = getCallback(callback);
  var self = this;
  self.connection.redis.set(self.connection.key('worker', self.name, self.stringQueues()), JSON.stringify({
    run_at: (new Date()).toString(),
    queue: self.queue,
    payload: job,
    worker: self.name,
  }), callback);
};

worker.prototype.doneWorking = function(callback) {
  callback = getCallback(callback);
  var self = this;
  self.working = false;
  self.connection.redis.del(self.connection.key('worker', self.name, self.stringQueues()), callback);
};

worker.prototype.track = function(callback) {
  callback = getCallback(callback);
  var self = this;
  self.running = true;
  self.connection.redis.sadd(self.connection.key('workers'), (self.name + ":" + self.stringQueues()), callback);
};

worker.prototype.untrack = function(name, queues, callback) {
  callback = getCallback(callback);
  var self = this;
  if(self.connection && self.connection.redis){
    self.connection.redis.srem(self.connection.key('workers'), (name + ":" + queues), function(err){
      if (err) return callback(err);

      self.connection.redis.del([
        self.connection.key('worker', name, self.stringQueues()),
        self.connection.key('worker', name, self.stringQueues(), 'started'),
        self.connection.key('stat', 'failed', name),
        self.connection.key('stat', 'processed', name)
      ], callback);
    });
  }else{
    callback();
  }
};

worker.prototype.init = function(callback) {
  callback = getCallback(callback);
  var self = this;
  var args, _ref;
  self.track();
  self.connection.redis.set(self.connection.key('worker', self.name, self.stringQueues(), 'started'), Math.round((new Date()).getTime() / 1000), callback);
};

worker.prototype.workerCleanup = function(callback){
  var self = this;
  self.getPids(function(err, pids){
    self.connection.redis.smembers(self.connection.key('workers'), function(err, workers){
      if (err) {
        if (typeof callback === 'function')
          return callback(err);
        else
          return self.emit('error', null, null, err);
      }
      workers.forEach(function(w){
        var parts = w.split(":");
        var host = parts[0]; var pid = parseInt(parts[1]); var queues = parseInt(parts[2]);
        if(host === os.hostname() && pids.indexOf(pid) < 0){
          (function(w){
            self.emit("cleaning_worker", w, pid);
            var parts = w.split(":");
            var queues = parts.splice(-1, 1);
            var pureName = parts.join(':');
            self.untrack(pureName, queues);
          })(w);
        }
      });
      if(typeof callback === 'function'){ callback(); }
    });
  });
};

worker.prototype.getPids = function(callback){
  callback = getCallback(callback);
  var cmd = '';
  if ( process.platform === 'win32' ) {
    cmd = 'for /f "usebackq tokens=2 skip=2" %i in (`tasklist /nh`) do @echo %i';
  } else {
    cmd = 'ps awx | grep -v grep';
  }

  var child = exec(cmd, function(error, stdout, stderr){
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
};

worker.prototype.checkQueues = function(callback){
  callback = getCallback(callback);
  var self = this;
  if (typeof self.queues == "string"){
    self.queues = [self.queues];
  }
  if (self.ready === true && self.queues.length > 0 && self.queues.shift) {
    return;
  }
  if (( self.queues[0] === '*' && self.queues.length == 1 ) || self.queues.length === 0 ) {
    self.originalQueue = "*";
    self.untrack(self.name, self.stringQueues(), function(){
      self.connection.redis.smembers(self.connection.key('queues'), function(err, resp) {
        self.queues = resp ? resp.sort() : [];
        self.track(function(){
          self.ready = true;
          callback();
        });
      });
    });
  }else{
    if(self.queues instanceof String){ self.queues = self.queues.split(','); }
    self.ready = true;
    callback();
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
    backtrace: err.stack ? err.stack.split('\n').slice(1) : null,
    failed_at: (new Date()).toString()
  };
};

worker.prototype.stringQueues = function(){
  var self = this;
  if(self.queues.length === 0){
    return ["*"].join(",");
  }else{
    try{
      return self.queues.join(',');
    }catch(e){
      return '';
    }
  }
};

function prepareJobs(jobs) {
  return Object.keys(jobs).reduce(function(h, k) {
    var job = jobs[k];
    h[k] = typeof job === 'function' ? { perform: job } : job;
    return h;
  }, {});
}

exports.worker = worker;
