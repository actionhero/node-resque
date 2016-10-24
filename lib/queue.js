var util         = require('util');
var async        = require('async');
var EventEmitter = require('events').EventEmitter;
var connection   = require(__dirname + '/connection.js').connection;
var pluginRunner = require(__dirname + '/pluginRunner.js');

var queue = function(options, jobs){
  var self = this;
  if(!jobs){ jobs = {}; }

  self.options = options;
  self.jobs    = jobs;

  self.connection = new connection(options.connection);

  self.connection.on('error', function(error){
    self.emit('error', error);
  });
};

util.inherits(queue, EventEmitter);

queue.prototype.connect = function(callback){
  var self = this;
  self.connection.connect(callback);
};

queue.prototype.end = function(callback){
  var self = this;
  self.connection.end();
  return callback();
};

queue.prototype.encode = function(q, func, args){
  return JSON.stringify({
    'class': func,
    queue: q,
    args: args || []
  });
};

queue.prototype.enqueue = function(q, func, args, callback){
  var self = this;
  var jobs = [];
  if(arguments.length === 3 && typeof args === 'function'){
    callback = args;
    args = [];
  }else if(arguments.length < 3){
    args = [];
  }

  args = arrayify(args);
  var job = self.jobs[func];

  pluginRunner.runPlugins(self, 'before_enqueue', func, q, job, args, function(error, toRun){
    if(error){ return callback(error); }
    if(toRun === false){ return callback(error, toRun); }

    jobs.push(function(done){
      self.connection.redis.sadd(self.connection.key('queues'), q, done);
    });

    jobs.push(function(done){
      self.connection.redis.rpush(self.connection.key('queue', q), self.encode(q, func, args), done);
    });

    jobs.push(function(done){
      pluginRunner.runPlugins(self, 'after_enqueue', func, q, job, args, done);
    });

    async.series(jobs, callback);
  });
};

queue.prototype.enqueueAt = function(timestamp, q, func, args, callback){
  // Don't run plugins here, they should be run by scheduler at the enqueue step
  var self = this;
  var jobs = [];

  if(arguments.length === 4 && typeof args === 'function'){
    callback = args;
    args = [];
  }else if(arguments.length < 4){
    args = [];
  }

  args = arrayify(args);
  var item = self.encode(q, func, args);
  var rTimestamp = Math.round(timestamp / 1000); // assume timestamp is in ms

  jobs.push(function(done){
    // check if this jobs is already enqueued at this time
    var match = ('delayed:' + rTimestamp);
    self.connection.redis.smembers(self.connection.key('timestamps:' + item), function(error, members){
      for(var i in members){
        if(members[i] === match){
          return done(new Error('Job already enqueued at this time with same arguments'));
        }
      }

      done(error);
    });
  });

  jobs.push(function(done){
    // enqueue the encoded job into a list per timestmp to be popped and workered later
    self.connection.redis.rpush(self.connection.key('delayed:' + rTimestamp), item, done);
  });

  jobs.push(function(done){
    // save the job + args into a set so that it can be checked by plugins
    self.connection.redis.sadd(self.connection.key('timestamps:' + item), ('delayed:' + rTimestamp), done);
  });

  jobs.push(function(done){
    self.connection.redis.zadd(self.connection.key('delayed_queue_schedule'), rTimestamp, rTimestamp, done);
  });

  async.series(jobs, callback);
};

queue.prototype.enqueueIn = function(time, q, func, args, callback){
  var self = this;

  if(arguments.length === 4 && typeof args === 'function'){
    callback = args;
    args = [];
  }else if(arguments.length < 4){
    args = [];
  }

  args = arrayify(args);
  var timestamp = (new Date().getTime()) + parseInt(time, 10);
  self.enqueueAt(timestamp, q, func, args, callback);
};

queue.prototype.queues = function(callback){
  var self = this;
  self.connection.redis.smembers(self.connection.key('queues'), callback);
};

queue.prototype.delQueue = function(q, callback){
  var self = this;
  self.connection.redis.del(self.connection.key('queue', q), function(error){
    if(error){ return callback(error); }
    self.connection.redis.srem(self.connection.key('queues'), q, callback);
  });
};

queue.prototype.length = function(q, callback){
  var self = this;
  self.connection.redis.llen(self.connection.key('queue', q), callback);
};

queue.prototype.del = function(q, func, args, count, callback){
  var self = this;

  if(typeof count === 'function' && callback === undefined){
    callback = count;
    count = 0;
  }else if(arguments.length === 3){
    if(typeof args === 'function'){
      callback = args;
      args = [];
    }
    count = 0;
  }else if(arguments.length < 3){
    args = [];
    count = 0;
  }

  args = arrayify(args);
  self.connection.redis.lrem(self.connection.key('queue', q), count, self.encode(q, func, args), callback);
};

queue.prototype.delDelayed = function(q, func, args, callback){
  var self = this;
  var jobs = [];
  var timestamps = [];

  if(arguments.length === 3 && typeof args === 'function'){
    callback = args;
    args = [];
  }else if(arguments.length < 3){
    args = [];
  }

  args = arrayify(args);
  var search = self.encode(q, func, args);
  var timestamps = [];
  self.connection.redis.smembers(self.connection.key('timestamps:' + search), function(error, members){
    if(error){ return callback(error); }

    members.forEach(function(key){
      jobs.push(function(done){
        self.connection.redis.lrem(self.connection.key(key), 0, search, function(error, count){
          if(error){ return done(error); }
          if(count > 0){
            timestamps.push(key.split(':')[key.split(':').length - 1]);
            self.connection.redis.srem(self.connection.key('timestamps:' + search), key, done);
          }else{
            done();
          }
        });
      });
    });

    async.series(jobs, function(error){
      return callback(error, timestamps);
    });
  });
};

queue.prototype.scheduledAt = function(q, func, args, callback){
  var self = this;
  var timestamps = [];

  if(arguments.length === 3 && typeof args === 'function'){
    callback = args;
    args = [];
  }else if(arguments.length < 3){
    args = [];
  }
  args = arrayify(args);
  var search = self.encode(q, func, args);

  self.connection.redis.smembers(self.connection.key('timestamps:' + search), function(error, members){
    if(members !== null){
      members.forEach(function(key){
        timestamps.push(key.split(':')[key.split(':').length - 1]);
      });
    }

    callback(error, timestamps);
  });
};

queue.prototype.timestamps = function(callback){
  var self = this;
  var results = [];
  self.connection.redis.keys(self.connection.key('delayed:*'), function(error, timestamps){
    timestamps.forEach(function(timestamp){
      var parts = timestamp.split(':');
      results.push(parseInt(parts[(parts.length - 1)]) * 1000);
    });
    results.sort();
    callback(error, results);
  });
};

queue.prototype.delayedAt = function(timestamp, callback){
  var self = this;
  var rTimestamp = Math.round(timestamp / 1000); // assume timestamp is in ms
  self.connection.redis.lrange(self.connection.key('delayed:' + rTimestamp), 0, -1, function(error, items){
    var tasks = items.map(function(i){ return JSON.parse(i); });
    callback(error, tasks, rTimestamp);
  });
};

queue.prototype.queued = function(q, start, stop, callback){
  var self = this;
  self.connection.redis.lrange(self.connection.key('queue', q), start, stop, function(error, items){
    var tasks = items.map(function(i){ return JSON.parse(i); });
    callback(error, tasks);
  });
};

queue.prototype.allDelayed = function(callback){
  var self = this;
  var results = {};
  var jobs = [];

  self.timestamps(function(error, timestamps){
    if(error){ return callback(error); }

    timestamps.forEach(function(timestamp){
      jobs.push(function(done){
        self.delayedAt(timestamp, function(error, tasks, rTimestamp){
          if(error){ return done(error); }
          results[(rTimestamp * 1000)] = tasks;
          done();
        });
      });
    });

    async.series(jobs, function(error){
      return callback(error, results);
    });
  });
};

queue.prototype.locks = function(callback){
  var self = this;
  var keys = [];
  var data = {};
  var jobs = [];

  jobs.push(function(done){
    self.connection.redis.keys(self.connection.key('lock:*'), function(error, _keys){
      if(error){ return done(error); }
      keys = keys.concat(_keys);
      done();
    });
  });

  jobs.push(function(done){
    self.connection.redis.keys(self.connection.key('workerslock:*'), function(error, _keys){
      if(error){ return done(error); }
      keys = keys.concat(_keys);
      done();
    });
  });

  async.parallel(jobs, function(error){
    if(error){ return callback(error); }
    if(keys.length === 0){ return callback(null, data); }

    self.connection.redis.mget(keys, function(error, values){
      if(error){ return callback(error); }

      for(var i = 0; i < keys.length; i++){
        var k = keys[i];
        k = k.replace(self.connection.key(''), '');
        data[k] = values[i];
      }

      callback(null, data);
    });
  });
};

queue.prototype.delLock = function(key, callback){
  var self = this;
  self.connection.redis.del(self.connection.key(key), callback);
};

queue.prototype.workers = function(callback){
  var self = this;
  var workers = {};
  self.connection.redis.smembers(self.connection.key('workers'), function(error, results){
    if(!error && results){
      results.forEach(function(r){
        var parts = r.split(':');
        var name;
        var queues;
        if(parts.length === 1){
          name = parts[0];
          workers[name] = null;
        }
        else if(parts.length === 2){
          name = parts[0];
          queues = parts[1];
          workers[name] = queues;
        }else{
          name = parts.shift() + ':' + parts.shift();
          queues = parts.join(':');
          workers[name] = queues;
        }
      });
    }

    return callback(error, workers);
  });
};

queue.prototype.workingOn = function(workerName, queues, callback){
  var self = this;
  var fullWorkerName = workerName + ':' + queues;
  self.connection.redis.get(self.connection.key('worker', fullWorkerName), callback);
};

queue.prototype.allWorkingOn = function(callback){
  var self = this;
  var results = {};
  var jobs = [];

  self.workers(function(error, workers){
    if(error){ return callback(error); }

    Object.keys(workers).forEach(function(w){
      jobs.push(function(done){
        results[w] = 'started';
        self.workingOn(w, workers[w], function(error, data){
          if(error){ return done(error); }
          if(data){
            data = JSON.parse(data);
            results[data.worker] = data;
          }
          done();
        });
      });
    });

    async.series(jobs, function(error){
      return callback(error, results);
    });
  });
};

queue.prototype.forceCleanWorker = function(workerName, callback){
  var self = this;
  var errorPayload;
  var jobs = [];

  self.workers(function(error, workers){
    if(error){ return callback(error); }
    var queues = workers[workerName];
    if(!queues){ return callback(new Error('worker not round')); }

    self.workingOn(workerName, queues, function(error, workingOn){
      if(error){ return callback(error); }
      if(workingOn){
        workingOn = JSON.parse(workingOn);
        errorPayload = {
          worker: workerName,
          queue: workingOn.queue,
          payload: workingOn.payload,
          exception: 'Worker Timeout (killed manually)',
          error: 'Worker Timeout (killed manually)',
          backtrace: null,
          failed_at: (new Date()).toString()
        };

        jobs.push(function(done){
          self.connection.redis.incr(self.connection.key('stat', 'failed'), done);
        });

        jobs.push(function(done){
          self.connection.redis.incr(self.connection.key('stat', 'failed', workerName), done);
        });

        jobs.push(function(done){
          self.connection.redis.rpush(self.connection.key('failed'), JSON.stringify(errorPayload), done);
        });
      }

      jobs.push(function(done){
        self.connection.redis.del(self.connection.key('stat', 'failed', workerName), done);
      });

      jobs.push(function(done){
        self.connection.redis.del(self.connection.key('stat', 'processed', workerName), done);
      });

      jobs.push(function(done){
        self.connection.redis.del(self.connection.key('worker', workerName), done);
      });

      jobs.push(function(done){
        self.connection.redis.srem(self.connection.key('workers'), workerName + ':' + queues, done);
      });

      async.series(jobs, function(error){
        return callback(error, errorPayload);
      });
    });
  });
};

queue.prototype.cleanOldWorkers = function(age, callback){
  // note: this method will remove the data created by a 'stuck' worker and move the payload to the error queue
  // however, it will not actually remove any processes which may be running.  A job *may* be running that you have removed

  var self = this;
  var results = {};
  var jobs = [];

  self.allWorkingOn(function(error, data){
    if(error){ return callback(error); }

    Object.keys(data).forEach(function(workerName){
      jobs.push(function(done){
        if(Date.now() - Date.parse(data[workerName].run_at) > age){
          self.forceCleanWorker(workerName, function(error, errorPayload){
            if(errorPayload && errorPayload.worker){ results[errorPayload.worker] = errorPayload; }
            done(error);
          });
        }else{
          done();
        }
      });
    });

    async.series(jobs, function(error){
      return callback(error, results);
    });
  });
};

queue.prototype.failedCount = function(callback){
  var self = this;
  self.connection.redis.llen(self.connection.key('failed'), callback);
};

queue.prototype.failed = function(start, stop, callback){
  var self = this;
  self.connection.redis.lrange(self.connection.key('failed'), start, stop, function(error, data){
    var results = data.map(function(i){ return JSON.parse(i); });
    callback(error, results);
  });
};

queue.prototype.removeFailed = function(failedJob, callback){
  var self = this;
  self.connection.redis.lrem(self.connection.key('failed'), 1, JSON.stringify(failedJob), callback);
};

queue.prototype.retryAndRemoveFailed = function(failedJob, callback){
  var self = this;
  self.removeFailed(failedJob, function(error, countFailed){
    if(error){ return callback(error, failedJob); }
    if(countFailed < 1){ return callback(new Error('This job is not in failed queue'), failedJob); }
    self.enqueue(failedJob.queue, failedJob.payload['class'], failedJob.payload.args, callback);
  });
};

queue.prototype.stats = function(callback){
  var self = this;
  self.connection.redis.keys(self.connection.key('stat:*'), function(error, keys){
    if(error){ return callback(error); }
    if(keys.length === 0){ return callback(); }

    self.connection.redis.mget(keys, function(error, values){
      if(error){ return callback(error); }

      var data = {};
      for(var i = 0; i < keys.length; i++){
        var k = keys[i];
        k = k.replace(self.connection.key('stat:'), '');
        data[k] = values[i];
      }

      callback(null, data);
    });
  });
};

/////////////
// HELPERS //
/////////////

var arrayify = function(o){
  if(Array.isArray(o)){
    return o;
  }else{
    return [o];
  }
};

exports.queue = queue;
