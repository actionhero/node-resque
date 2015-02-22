var util = require('util');
var connection = require(__dirname + "/connection.js").connection;
var pluginRunner = require(__dirname + "/pluginRunner.js");

var queue = function(options, jobs, callback){
  var self = this;
  if(typeof jobs == 'function' && callback == null){
    callback = jobs;
    jobs = {};
  }
  self.options = options;
  self.jobs = jobs;
  self.queueObject = self; // to keep plugins consistant

  self.runPlugin  = pluginRunner.runPlugin
  self.runPlugins = pluginRunner.runPlugins

  self.connection = new connection(options.connection);
  self.connection.connect(function(err){
    if(typeof callback === 'function'){ callback(err); }
  });
}

queue.prototype.end = function(callback){
  var self = this;
  self.connection.redis.quit();
  process.nextTick(function(){
    if(typeof callback === 'function'){ callback(); }
  });
}

queue.prototype.encode = function(q, func, args){
  return JSON.stringify({
    "class": func,
    queue: q,
    args: args || []
  });
}

queue.prototype.enqueue = function(q, func, args, callback){
  var self = this;
  var args = arrayify(args);
  var job = self.jobs[func];
  self.runPlugins('before_enqueue', func, q, job, args, function(err, toRun){
    if(toRun == false){
      if(typeof callback === 'function'){ callback(err, toRun); }
    }else{
      self.connection.ensureConnected(callback, function(){
        self.connection.redis.sadd(self.connection.key('queues'), q, function(){
          self.connection.redis.rpush(self.connection.key('queue', q), self.encode(q, func, args), function(){
            self.runPlugins('after_enqueue', func, q, job, args, function(){
              if(typeof callback === 'function'){ callback(err, toRun); }
            });
          });
        });
      });
    }
  });
}

queue.prototype.enqueueAt = function(timestamp, q, func, args, callback){
  // Don't run plugins here, they should be run by scheduler at the enqueue step
  var self = this;
  var args = arrayify(args);
  self.connection.ensureConnected(callback, function(){
    var item = self.encode(q, func, args);
    var rTimestamp = Math.round(timestamp / 1000); // assume timestamp is in ms
    // enqueue the encoded job into a list per timestmp to be popped and workered later
    self.connection.redis.rpush(self.connection.key("delayed:" + rTimestamp), item, function(){
      // save the job + args into a set so that it can be checked by plugins
      self.connection.redis.sadd(self.connection.key("timestamps:" + item), self.connection.key("delayed:" + rTimestamp), function(){
        // and the timestamp in question to a zset to the scheduler will know which timestamps have data to work
        self.connection.redis.zadd(self.connection.key('delayed_queue_schedule'), rTimestamp, rTimestamp, function(){
          if(typeof callback === 'function'){ callback(); }
        });
      });
    });
  });
};

queue.prototype.enqueueIn = function(time, q, func, args, callback){
  var self = this;
  var args = arrayify(args);
  var timestamp = (new Date().getTime()) + time;
  self.enqueueAt(timestamp, q, func, args, function(){
    if(typeof callback === 'function'){ callback(); }
  });
}

queue.prototype.queues = function(callback){
  var self = this;
  self.connection.ensureConnected(callback, function(){
    self.connection.redis.smembers(self.connection.key('queues'), function(err, queues){
      callback(err, queues);
    });
  });
}

queue.prototype.delQueue = function(q, callback){
  var self = this;
  self.connection.redis.del(self.connection.key('queue', q), function(err){
    callback(err);
  });
}

queue.prototype.length = function(q, callback){
  var self = this;
  self.connection.ensureConnected(callback, function(){
    self.connection.redis.llen(self.connection.key('queue', q), function(err, length){
      callback(err, length);
    });
  });
}

queue.prototype.del = function(q, func, args, count, callback){
  var self = this;
  var args = arrayify(args);
  if(typeof count == 'function' && callback == null){
    callback = count;
    count = 0; // remove first enqueued items that match
  }
  self.connection.ensureConnected(callback, function(){
    self.connection.redis.lrem(self.connection.key('queue', q), count, self.encode(q, func, args), function(err, count){
      if(typeof callback === 'function'){ callback(err, count); }
    });
  });
}

queue.prototype.delDelayed = function(q, func, args, callback){
  var self = this;
  var args = arrayify(args);
  var search = self.encode(q, func, args);
  self.connection.ensureConnected(callback, function(){
    var timestamps = self.connection.redis.smembers(self.connection.key("timestamps:" + search), function(err, members){
      if(members.length == 0 ){ if(typeof callback === 'function'){ callback(err, []); } }
      else{
        var started = 0;
        var timestamps = [];
        members.forEach(function(key){
          started++;
          self.connection.redis.lrem(key, 0, search, function(){
            self.connection.redis.srem(self.connection.key("timestamps:" + search), key, function(){
              timestamps.push(key.split(":")[key.split(":").length - 1]);
              started--;
              if(started == 0){
                if(typeof callback === 'function'){ callback(err, timestamps); }
              }
            })
          })
        });
      }
    });
  });
}

queue.prototype.scheduledAt = function(q, func, args, callback){
  var self = this;
  var args = arrayify(args);
  var search = self.encode(q, func, args);
  self.connection.ensureConnected(callback, function(){
    self.connection.redis.smembers(self.connection.key("timestamps:" + search), function(err, members){
      var timestamps = [];
      if(members != null){
        members.forEach(function(key){
          timestamps.push(key.split(":")[key.split(":").length - 1]);
        })
      }
      if(typeof callback === 'function'){ callback(err, timestamps); }
    });
  });
}

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
}

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
}

queue.prototype.allDelayed = function(callback){
  var self = this;
  var started = 0;
  var results = {};
  self.timestamps(function(err, timestamps){
    timestamps.forEach(function(timestamp){
      started++;
      self.delayedAt(timestamp, function(err, tasks, rTimestamp){
        results[(rTimestamp * 1000)] = tasks;
        started--;
        if(started === 0){ callback(err, results) }
      });
    });
  });
}

queue.prototype.workers = function(callback){
  var self = this;
  var workers = {}
  self.connection.redis.smembers(self.connection.key('workers'), function(err, results){
    if(results){
      results.forEach(function(r){
        var parts = r.split(':');
        var name, queues;
        if(parts.length === 1){
          var name = parts[0];
          workers[name] = null;
        }
        else if(parts.length === 2){
          var name = parts[0];
          var queues = parts[1];
          workers[name] = queues;
        }else{
          var name = parts.shift() + ":" + parts.shift();
          var queues = parts.join(':');
          workers[name] = queues;
        }
      })
    }
    if(typeof callback === 'function'){ callback(err, workers); }
  });
}

queue.prototype.workingOn = function(workerName, queues, callback){
  var self = this;
  var fullWorkerName = workerName + ':' + queues;
  self.connection.redis.get(self.connection.key('worker', fullWorkerName), function(err, data){
    if(typeof callback === 'function'){ callback(err, data); }
  });
}

queue.prototype.allWorkingOn = function(callback){
  var self = this;
  var results = {};
  var counter = 0;
  self.workers(function(err, workers){
    if(err && typeof callback === 'function'){ 
      callback(err);
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
      };
    }
  });
}

/////////////
// helpers //
/////////////

var arrayify = function(o){
  if( Array.isArray(o) ) {
    return o;
  }else{
    return [o];
  }
}

var hashLength = function(obj) {
  var size = 0, key;
  for(key in obj){
    if(obj.hasOwnProperty(key)){ size++ }
  }
  return size;
}

exports.queue = queue;