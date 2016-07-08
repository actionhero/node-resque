var util         = require('util');
var EventEmitter = require('events').EventEmitter;
var connection   = require(__dirname + "/connection.js").connection;
var pluginRunner = require(__dirname + "/pluginRunner.js");

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
  if(typeof callback === 'function'){ callback(); }
};

queue.prototype.encode = function(q, func, args){
  return JSON.stringify({
    "class": func,
    queue: q,
    args: args || []
  });
};

queue.prototype.enqueue = function(q, func, args, callback){
  var self = this;
  if(arguments.length === 3 && typeof args === 'function'){
    callback = args;
    args = [];
  }else if(arguments.length < 3){
    args = [];
  }

  args = arrayify(args);
  var job = self.jobs[func];
  pluginRunner.runPlugins(self, 'before_enqueue', func, q, job, args, function(err, toRun){
    if(toRun === false){
      if(typeof callback === 'function'){ callback(err, toRun); }
    }else{
      self.connection.redis.sadd(self.connection.key('queues'), q, function(){
        self.connection.redis.rpush(self.connection.key('queue', q), self.encode(q, func, args), function(){
          pluginRunner.runPlugins(self, 'after_enqueue', func, q, job, args, function(){
            if(typeof callback === 'function'){ callback(err, toRun); }
          });
        });
      });
    }
  });
};

queue.prototype.enqueueAt = function(timestamp, q, func, args, callback){
  // Don't run plugins here, they should be run by scheduler at the enqueue step
  var self = this;
  if(arguments.length === 4 && typeof args === 'function'){
    callback = args;
    args = [];
  }else if(arguments.length < 4){
    args = [];
  }

  args = arrayify(args);
  var item = self.encode(q, func, args);
  var rTimestamp = Math.round(timestamp / 1000); // assume timestamp is in ms
  // enqueue the encoded job into a list per timestmp to be popped and workered later
  self.connection.redis.rpush(self.connection.key("delayed:" + rTimestamp), item, function(){
    // save the job + args into a set so that it can be checked by plugins
    self.connection.redis.sadd(self.connection.key("timestamps:" + item), "delayed:" + rTimestamp, function(){
      // and the timestamp in question to a zset to the scheduler will know which timestamps have data to work
      self.connection.redis.zadd(self.connection.key('delayed_queue_schedule'), rTimestamp, rTimestamp, function(){
        if(typeof callback === 'function'){ callback(); }
      });
    });
  });
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
  var timestamp = (new Date().getTime()) + time;
  self.enqueueAt(timestamp, q, func, args, function(){
    if(typeof callback === 'function'){ callback(); }
  });
};

queue.prototype.queues = function(callback){
  var self = this;
  self.connection.redis.smembers(self.connection.key('queues'), callback);
};

queue.prototype.delQueue = function(q, callback){
  var self = this;
  self.connection.redis.del(self.connection.key('queue', q), function(err){
    if(err) return callback(err);
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
  self.connection.redis.lrem(self.connection.key('queue', q), count, self.encode(q, func, args), function(err, count){
    if(typeof callback === 'function'){ callback(err, count); }
  });
};

queue.prototype.delDelayed = function(q, func, args, callback){
  var self = this;
  if(arguments.length === 3 && typeof args === 'function'){
    callback = args;
    args = [];
  }else if(arguments.length < 3){
    args = [];
  }

  args = arrayify(args);
  var search = self.encode(q, func, args);
  var timestamps = self.connection.redis.smembers(self.connection.key("timestamps:" + search), function(err, members){
    if(members.length === 0 ){ if(typeof callback === 'function'){ callback(err, []); } }
    else{
      var started = 0;
      var timestamps = [];
      members.forEach(function(key){
        started++;
        self.connection.redis.lrem(self.connection.key(key), 0, search, function(err, count){
          if(count > 0) {
            self.connection.redis.srem(self.connection.key("timestamps:" + search), key, function(){
              timestamps.push(key.split(":")[key.split(":").length - 1]);
              started--;
              if(started === 0){
                if(typeof callback === 'function'){ callback(err, timestamps); }
              }
            });
          } else {
            if(typeof callback === 'function'){ callback(err, []); }
          }
        });
      });
    }
  });
};

queue.prototype.scheduledAt = function(q, func, args, callback){
  var self = this;
  if(arguments.length === 3 && typeof args === 'function'){
    callback = args;
    args = [];
  }else if(arguments.length < 3){
    args = [];
  }

  args = arrayify(args);
  var search = self.encode(q, func, args);
  self.connection.redis.smembers(self.connection.key("timestamps:" + search), function(err, members){
    var timestamps = [];
    if(members !== null){
      members.forEach(function(key){
        timestamps.push(key.split(":")[key.split(":").length - 1]);
      });
    }
    if(typeof callback === 'function'){ callback(err, timestamps); }
  });
};

queue.prototype.timestamps = function(callback){
  var self = this;
  var results = [];
  self.connection.redis.keys(self.connection.key("delayed:*"), function(err, timestamps){
    timestamps.forEach(function(timestamp){
      var parts = timestamp.split(":");
      results.push(parseInt(parts[(parts.length - 1)]) * 1000);
    });
    results.sort();
    callback(err, results);
  });
};

queue.prototype.delayedAt = function(timestamp, callback){
  var self = this;
  var rTimestamp = Math.round(timestamp / 1000); // assume timestamp is in ms
  var tasks = [];
  self.connection.redis.lrange(self.connection.key("delayed:" + rTimestamp), 0, -1, function(err, items){
    items.forEach(function(i){
      tasks.push( JSON.parse(i) );
    });
    callback(err, tasks, rTimestamp);
  });
};

queue.prototype.queued = function(q, start, stop, callback){
  var self = this;
  self.connection.redis.lrange(self.connection.key('queue', q), start, stop, function(err, items){
    var tasks = items.map(function(i){
      return JSON.parse(i);
    });
    callback(err, tasks);
  });
};

queue.prototype.allDelayed = function(callback){
  var self = this;
  var started = 0;
  var results = {};
  self.timestamps(function(err, timestamps){
    if(timestamps.length === 0){
      callback(err, {});
    }else{
      timestamps.forEach(function(timestamp){
        started++;
        self.delayedAt(timestamp, function(err, tasks, rTimestamp){
          results[(rTimestamp * 1000)] = tasks;
          started--;
          if(started === 0){ callback(err, results); }
        });
      });
    }
  });
};

queue.prototype.locks = function(callback){
  var self = this;
  var keys = [];
  var data = {};

  self.connection.redis.keys(self.connection.key('lock:*'), function(err, _keys){
    if(err){ return callback(err); }
    keys = keys.concat(_keys);
    self.connection.redis.keys(self.connection.key('workerslock:*'), function(err, _keys){
      if(err){ return callback(err); }
      keys = keys.concat(_keys);

      if(keys.length === 0){ return callback(null, data); }

      self.connection.redis.mget(keys, function(err, values){
        if(err){return callback(err); }
        for (var i = 0; i < keys.length; i++){
          var k = keys[i];
          k = k.replace(self.connection.key(''), '');
          data[k] = values[i];
        }
        callback(null, data);
      });

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
  self.connection.redis.smembers(self.connection.key('workers'), function(err, results){
    if(!err && results){
      results.forEach(function(r){
        var parts = r.split(':');
        var name, queues;
        if(parts.length === 1){
          name = parts[0];
          workers[name] = null;
        }
        else if(parts.length === 2){
          name = parts[0];
          queues = parts[1];
          workers[name] = queues;
        }else{
          name = parts.shift() + ":" + parts.shift();
          queues = parts.join(':');
          workers[name] = queues;
        }
      });
    }
    if(typeof callback === 'function'){ callback(err, workers); }
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
  var counter = 0;
  self.workers(function(err, workers){
    if(err && typeof callback === 'function'){
      callback(err, results);
    }else if(!workers || hashLength(workers) === 0){
      callback(null, results);
    }else{
      for(var w in workers){
        counter++;
        results[w] = 'started';
        self.workingOn(w, workers[w], function(err, data){
          counter--;
          if(data){
            data = JSON.parse(data);
            results[data.worker] = data;
          }
          if(counter === 0 && typeof callback === 'function'){
            callback(err, results);
          }
        });
      }
    }
  });
};

queue.prototype.forceCleanWorker = function(workerName, callback){
  var self = this;
  self.workers(function(err, workers){
    var queues = workers[workerName];
    var errorPayload;
    if(err){ callback(err); }
    else if(!queues){ callback(new Error('worker not round')); }
    else{
      self.workingOn(workerName, queues, function(err, workingOn){
        if(err){ callback(err); }
        else if(workingOn){
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
          self.connection.redis.incr(self.connection.key('stat', 'failed'));
          self.connection.redis.incr(self.connection.key('stat', 'failed', workerName));
          self.connection.redis.rpush(self.connection.key('failed'), JSON.stringify(errorPayload));
        }

        self.connection.redis.del([
          self.connection.key('stat', 'failed', workerName),
          self.connection.key('stat', 'processed', workerName),
          self.connection.key('worker', workerName),
          self.connection.redis.srem(self.connection.key('workers'), workerName + ':' + queues)
        ], function(err, data){
          callback(err, errorPayload);
        });

      });
    }
  });
};

queue.prototype.cleanOldWorkers = function(age, callback){
  // note: this method will remove the data created by a "stuck" worker and move the payload to the error queue
  // however, it will not actually remove any processes which may be running.  A job *may* be running that you have removed
  var self = this;
  var results = {};
  self.allWorkingOn(function(err, data){
    if(err && typeof callback === 'function'){
      callback(err);
    }else if((!data || hashLength(data) && typeof callback === 'function' ) === 0){
      callback(null, results);
    }else{
      var started = 0;
      for(var workerName in data){
        started++;
        if(Date.now() - Date.parse(data[workerName].run_at) > age){
          self.forceCleanWorker(workerName, function(error, errorPayload){
            if(errorPayload && errorPayload.worker ){ results[errorPayload.worker] = errorPayload; }
            started--;
            if(started === 0 && typeof callback === 'function'){
              callback(null, results);
            }
          });
        }else{
          process.nextTick(function(){
            started--;
            if(started === 0 && typeof callback === 'function'){
              callback(null, results);
            }
          });
        }
      }
    }
  });
};

queue.prototype.failedCount = function(callback){
  var self = this;
  self.connection.redis.llen(self.connection.key('failed'), function(err, length){
    callback(err, length);
  });
};

queue.prototype.failed = function(start, stop, callback){
  var self = this;
  var results = [];
  self.connection.redis.lrange(self.connection.key('failed'), start, stop, function(err, data){
    data.forEach(function(d){ results.push( JSON.parse(d) ); });
    callback(err, results);
  });
};

queue.prototype.removeFailed = function(failedJob, callback){
  var self = this;
  self.connection.redis.lrem(self.connection.key('failed'), 1, JSON.stringify(failedJob), callback);
};

queue.prototype.retryAndRemoveFailed = function(failedJob, callback){
  var self = this;
  self.removeFailed(failedJob, function(err, countFailed){
    if(err){return callback(err, failedJob); }
    if(countFailed < 1 ){return callback(new Error('This job is not in failed queue'), failedJob); }
    self.enqueue(failedJob.queue, failedJob.payload.class, failedJob.payload.args, callback);
  });
};

queue.prototype.stats = function(callback){
  var self = this;
  self.connection.redis.keys(self.connection.key('stat:*'), function(err, keys){
    if(err){return callback(err); }
    if(keys.length === 0){return callback(); }
    self.connection.redis.mget(keys, function(err, values){
      if(err){return callback(err); }
      var data = {};
      for (var i = 0; i < keys.length; i++){
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

var hashLength = function(obj) {
  var size = 0, key;
  for(key in obj){
    if(obj.hasOwnProperty(key)){ size++; }
  }
  return size;
};

exports.queue = queue;
