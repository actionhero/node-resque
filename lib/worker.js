var os = require('os');
var util = require('util');
var async = require('async');
var exec = require('child_process').exec;
var EventEmitter = require('events').EventEmitter;
var connection   = require(__dirname + '/connection.js').connection;
var queue        = require(__dirname + '/queue.js').queue;
var pluginRunner = require(__dirname + '/pluginRunner.js');

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
  self.result = null;
  self.ready = false;
  self.running = false;
  self.working = false;
  self.job = null;

  self.queueObject = new queue({connection: options.connection}, self.jobs);

  self.queueObject.on('error', function(error){
    self.emit('error', null, null, error);
  });
};

util.inherits(worker, EventEmitter);

worker.prototype.defaults = function(){
  var self = this;
  return {
    name:      os.hostname() + ':' + process.pid, // assumes only one worker per node process
    queues:    '*',
    timeout:   5000,
    looping:   true,
  };
};

worker.prototype.connect = function(callback){
  var self = this;
  self.queueObject.connect(function(){
    self.connection = self.queueObject.connection;
    self.checkQueues(function(){
      if(typeof callback === 'function'){ callback(); }
    });
  });
};

worker.prototype.start = function(){
  var self = this;
  if(self.ready){
    self.emit('start');
    self.init(function(){
      self.poll();
    });
  }
};

worker.prototype.end = function(callback){
  var self = this;
  self.running = false;
  if(self.working === true){
    setTimeout(function(){
      self.end(callback);
    }, self.options.timeout);
  }else{
    self.untrack(self.name, self.stringQueues(), function(error){
      self.queueObject.end(function(error){
        self.emit('end');
        if(typeof callback === 'function'){ callback(error); }
      });
    });
  }
};

worker.prototype.poll = function(nQueue, callback){
  var self = this;
  if(nQueue === null || nQueue === undefined){
    nQueue = 0;
  }
  if(!self.running){
    if(typeof callback === 'function'){ callback(); }
  }else{
    self.queue = self.queues[nQueue];
    self.emit('poll', self.queue);
    if(self.queue === null || self.queue === undefined){
      self.checkQueues(function(){
        self.pause();
      });
    }else if(self.working === true){
      var error = new Error('refusing to get new job, already working');
      self.emit('error', self.queue, null, error);
    }else{
      self.working = true;
      self.connection.redis.lpop(self.connection.key('queue', self.queue), function(error, resp){
        if(!error && resp){
          var currentJob = JSON.parse(resp.toString());
          if(self.options.looping){
            self.result = null;
            self.perform(currentJob);
          }else{
            if(typeof callback === 'function'){ callback(currentJob); }
          }
        }else{
          if(error){
            self.emit('error', self.queue, null, error);
          }
          self.working = false;
          if(nQueue === self.queues.length - 1){
            process.nextTick(function(){
              if(self.options.looping){
                self.pause();
              }else{
                if(typeof callback === 'function'){ callback(); }
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

worker.prototype.perform = function(job, callback){
  var self = this;
  var returnCounter = 0; // a state counter to prevent multiple returns from poor jobs or plugins
  var callbackError = new Error('refusing to continue with job, multiple callbacks detected');
  self.job = job;
  self.error = null;
  if(!self.jobs[job['class']]){
    self.error = new Error('No job defined for class "' + job['class'] + '"');
    self.completeJob(true, callback);
  }else{
    var cb = self.jobs[job['class']].perform;
    self.emit('job', self.queue, job);

    if(cb){
      pluginRunner.runPlugins(self, 'before_perform', job['class'], self.queue, self.jobs[job['class']], job.args, function(err, toRun){
        returnCounter++;
        if(returnCounter !== 1){
          self.emit('failure', self.queue, job, callbackError);
        }else if(toRun === false){
          self.completeJob(false, callback);
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
              self.result = result;
              pluginRunner.runPlugins(self, 'after_perform', job['class'], self.queue, self.jobs[job['class']], job.args, function(e, toRun){
                if(self.error === undefined && e){ self.error = e; }
                returnCounter++;
                if(returnCounter !== 3){
                  self.emit('failure', self.queue, job, callbackError);
                }else{
                  self.completeJob(true, callback);
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

      self.error = new Error('Missing Job: ' + job['class']);
      self.completeJob(true, callback);
    }
  }
};

// #performInline is used to run a job payload directly.
// If you are planning on running a job via #performInline, this worker should also not be started, nor should be using event emitters to monitor this worker.
// This method will also not write to redis at all, including logging errors, modify resque's stats, etc.
worker.prototype.performInline = function(func, args, callback){
  var self          = this;
  var q             = '_direct-queue-' + self.name;
  var returnCounter = 0; // a state counter to prevent multiple returns from poor jobs or plugins
  var callbackError = new Error('refusing to continue with job, multiple callbacks detected');

  if(args !== undefined && args !== null && args instanceof Array !== true){
    args = [args];
  }

  if(!self.jobs[func]){         return callback(new Error('No job defined for class "' + func + '"')); }
  if(!self.jobs[func].perform){ return callback(new Error('Missing Job: ' + func));                    }

  pluginRunner.runPlugins(self, 'before_perform', func, q, self.jobs[func], args, function(err, toRun){
    returnCounter++;
    if(err){ return callback(err); }
    if(returnCounter !== 1){ return callback(callbackError); }
    if(toRun === false){ return callback(); }

    var combinedInputs = [].slice.call(args).concat([function(err, result){
      self.result = result;
      self.error = err;
      returnCounter++;
      if(err){ return callback(err); }
      if(returnCounter !== 2){ return callback(callbackError); }

      pluginRunner.runPlugins(self, 'after_perform', func, q, self.jobs[func], args, function(err, toRun){
        returnCounter++;
        if(err){ return callback(err); }
        if(returnCounter !== 3){ return callback(callbackError); }
        return callback(null, result);
      });
    }]);

    self.jobs[func].perform.apply(self, combinedInputs);
  });

};

worker.prototype.completeJob = function(toRespond, callback){
  var self = this;
  var job = self.job;
  var jobs = [];

  if(self.error){
    jobs.push(function(done){
      self.fail(self.error, done);
    });
  }else if(toRespond){
    jobs.push(function(done){
      self.succeed(job, done);
    });
  }

  jobs.push(function(done){
    self.doneWorking(done);
  });

  async.series(jobs, function(error){
    if(error){ self.emit('error', null, null, error); }
    self.job = null;

    if(self.options.looping){
      return self.poll();
    }else if(typeof callback === 'function'){
      return callback(error);
    }
  });
};

worker.prototype.succeed = function(job, callback){
  var self = this;
  var jobs = [];

  jobs.push(function(done){
    self.connection.redis.incr(self.connection.key('stat', 'processed'), done);
  });

  jobs.push(function(done){
    self.connection.redis.incr(self.connection.key('stat', 'processed', self.name), done);
  });

  async.series(jobs, function(error){
    if(error){ self.emit('error', null, null, error); }
    else{ self.emit('success', self.queue, job, self.result); }

    if(typeof callback === 'function'){ return callback(); }
  });
};

worker.prototype.fail = function(err, callback){
  var self = this;
  var jobs = [];
  var failingJob = self.job;

  jobs.push(function(done){
    self.connection.redis.incr(self.connection.key('stat', 'failed'), done);
  });

  jobs.push(function(done){
    self.connection.redis.incr(self.connection.key('stat', 'failed', self.name), done);
  });

  jobs.push(function(done){
    self.connection.redis.rpush(self.connection.key('failed'), JSON.stringify(self.failurePayload(err, failingJob)), done);
  });

  async.series(jobs, function(error){
    if(error){
      self.emit('error', null, null, error);
      if(typeof callback === 'function'){ return callback(error); }
    }else{
      self.emit('failure', self.queue, failingJob, err);
      if(typeof callback === 'function'){ return callback(); }
    }
  });
};

worker.prototype.pause = function(){
  var self = this;
  self.emit('pause');
  setTimeout(function(){
    if(!self.running){ return; }
    self.poll();
  }, self.options.timeout);
};

worker.prototype.workingOn = function(job){
  var self = this;
  self.connection.redis.set(self.connection.key('worker', self.name, self.stringQueues()), JSON.stringify({
    run_at: (new Date()).toString(),
    queue: self.queue,
    payload: job,
    worker: self.name,
  }));
};

worker.prototype.doneWorking = function(callback){
  var self = this;
  self.working = false;
  self.connection.redis.del(self.connection.key('worker', self.name, self.stringQueues()), callback);
};

worker.prototype.track = function(callback){
  var self = this;
  self.running = true;
  self.connection.redis.sadd(self.connection.key('workers'), (self.name + ':' + self.stringQueues()), function(error){
    if(error){ self.emit('error', null, null, error); }
    if(typeof callback === 'function'){ callback(error); }
  });
};

worker.prototype.untrack = function(name, queues, callback){
  var self = this;
  var jobs = [];

  if(self.connection && self.connection.redis){
    self.connection.redis.srem(self.connection.key('workers'), (name + ':' + queues), function(error){
      if(error){
        self.emit('error', null, null, error);
        if(typeof callback === 'function'){ callback(error); }
        return;
      }

      [
        self.connection.key('worker', name, self.stringQueues()),
        self.connection.key('worker', name, self.stringQueues(), 'started'),
        self.connection.key('stat', 'failed', name),
        self.connection.key('stat', 'processed', name)
      ].forEach(function(key){
        jobs.push(function(done){ self.connection.redis.del(key, done); });
      });

      async.series(jobs, function(error){
        if(error){ self.emit('error', null, null, error); }
        if(typeof callback === 'function'){ callback(error); }
      });
    });
  }else{
    callback();
  }
};

worker.prototype.init = function(callback){
  var self = this;
  var args;
  var _ref;
  self.track(function(error){
    if(error){
      self.emit('error', null, null, error);
      if(typeof callback === 'function'){ callback(error); }
      return;
    }

    self.connection.redis.set(self.connection.key('worker', self.name, self.stringQueues(), 'started'), Math.round((new Date()).getTime() / 1000), function(error){
      if(error){ self.emit('error', null, null, error); }
      if(typeof callback === 'function'){ callback(error); }
    });
  });
};

worker.prototype.workerCleanup = function(callback){
  var self = this;
  var jobs = [];
  self.getPids(function(error, pids){
    if(error){
      self.emit('error', null, null, error);
      if(typeof callback === 'function'){ callback(error); }
      return;
    }

    self.connection.redis.smembers(self.connection.key('workers'), function(error, workers){
      if(error){
        if(typeof callback === 'function'){ callback(error); }
        else{ self.emit('error', null, null, error); }
        return;
      }

      workers.forEach(function(w){
        var parts = w.split(':');
        var host = parts[0]; var pid = parseInt(parts[1]); var queues = parseInt(parts[2]);
        if(host === os.hostname() && pids.indexOf(pid) < 0){
          jobs.push(function(done){
            self.emit('cleaning_worker', w, pid);
            var parts = w.split(':');
            var queues = parts.splice(-1, 1);
            var pureName = parts.join(':');
            self.untrack(pureName, queues, done);
          });
        }
      });

      async.series(jobs, function(error){
        if(error){ self.emit('error', null, null, error); }
        if(typeof callback === 'function'){ callback(error); }
      });
    });
  });
};

worker.prototype.getPids = function(callback){
  var cmd;
  if(process.platform === 'win32'){
    cmd = 'for /f "usebackq tokens=2 skip=2" %i in (`tasklist /nh`) do @echo %i';
  }else{
    cmd = 'ps -ef | awk \'{print $2}\'';
  }

  var child = exec(cmd, function(error, stdout, stderr){
    var pids = [];
    stdout.split('\n').forEach(function(line){
      line = line.trim();
      if(line.length > 0){
        var pid = parseInt(line.split(' ')[0]);
        if(!isNaN(pid)){ pids.push(pid); }
      }
    });

    if(!error && stderr){ error = stderr; }
    callback(error, pids);
  });
};

worker.prototype.checkQueues = function(callback){
  var self = this;
  if(typeof self.queues === 'string'){
    self.queues = [self.queues];
  }
  if(self.ready === true && self.queues.length > 0 && self.queues.shift){
    return;
  }

  if((self.queues[0] === '*' && self.queues.length === 1) || self.queues.length === 0){
    self.originalQueue = '*';
    self.untrack(self.name, self.stringQueues(), function(error){
      if(error){
        self.emit('error', null, null, error);
        if(typeof callback === 'function'){ callback(error); }
        return;
      }

      self.connection.redis.smembers(self.connection.key('queues'), function(error, resp){
        if(error){
          self.emit('error', null, null, error);
          if(typeof callback === 'function'){ callback(error); }
          return;
        }

        self.queues = resp ? resp.sort() : [];
        self.track(function(error){
          if(error){ self.emit('error', null, null, error); }
          self.ready = true;
          if(typeof callback === 'function'){ callback(error); }
        });
      });
    });
  }else{
    if(self.queues instanceof String){ self.queues = self.queues.split(','); }
    self.ready = true;
    if(typeof callback === 'function'){ callback(); }
  }
};

worker.prototype.failurePayload = function(err, job){
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
    return ['*'].join(',');
  }else{
    try{
      return self.queues.join(',');
    }catch(e){
      return '';
    }
  }
};

function prepareJobs(jobs){
  return Object.keys(jobs).reduce(function(h, k){
    var job = jobs[k];
    h[k] = typeof job === 'function' ? { perform: job } : job;
    return h;
  }, {});
}

exports.worker = worker;
