// To read notes about the master locking scheme, check out:
//   https://github.com/resque/resque-scheduler/blob/master/lib/resque/scheduler/locking.rb

var EventEmitter = require('events').EventEmitter;
var util         = require('util');
var os           = require('os');
var connection   = require(__dirname + '/connection.js').connection;
var queue        = require(__dirname + '/queue.js').queue;

var scheduler = function(options, jobs){
  var self = this;
  if(!jobs){ jobs = {}; }
  var defaults = self.defaults();

  for(var i in defaults){
    if(options[i] === null || options[i] === undefined){
      options[i] = defaults[i];
    }
  }

  self.options    = options;
  self.name       = self.options.name;
  self.master     = false;
  self.running    = false;
  self.processing = false;

  self.queue = new queue({connection: options.connection}, jobs);

  self.queue.on('error', function(error){
    self.emit('error', error);
  });
};

util.inherits(scheduler, EventEmitter);

scheduler.prototype.defaults = function(){
  var self = this;
  return {
    timeout:           5000,   // in ms
    masterLockTimeout: 60 * 3, // in seconds
    name:              os.hostname() + ':' + process.pid, // assumes only one worker per node process
  };
};

scheduler.prototype.connect = function(callback){
  var self = this;
  self.queue.connect(function(){
    self.connection = self.queue.connection;
    if(typeof callback === 'function'){ callback(); }
  });
};

scheduler.prototype.start = function(){
  var self = this;
  self.processing = false;

  if(!self.running){
    self.emit('start');
    self.running = true;
    self.timer = setTimeout((function(){
      self.poll();
    }), self.options.timeout);
  }
};

scheduler.prototype.end = function(callback){
  var self = this;
  self.running = false;
  clearTimeout(self.timer);

  if(self.processing === false){
    self.releaseMasterLock(function(error, wasMaster){
      if(error){ self.emit('error', error); }
      self.queue.end(function(){
        self.emit('end');
        process.nextTick(function(){
          if(typeof callback === 'function'){ callback(); }
        });
      });
    });
  }

  else{
    setTimeout(function(){
      self.end(callback);
    }, (self.options.timeout / 2));
  }
};

scheduler.prototype.poll = function(callback){
  var self = this;
  self.processing = true;
  clearTimeout(self.timer);
  self.tryForMaster(function(error, isMaster){
    if(error){ self.emit('error', error); }
    if(isMaster){
      if(!self.master){
        self.master = true;
        self.emit('master');
      }
      self.emit('poll');
      self.nextDelayedTimestamp(function(error, timestamp){
        if(!error && timestamp){
          self.emit('working_timestamp', timestamp);
          self.enqueueDelayedItemsForTimestamp(timestamp, function(error){
            if(error){ self.emit('error', error); }
            self.poll(callback);
          });
        }else{
          if(error){ self.emit('error', error); }
          self.processing = false;
          self.pollAgainLater();
          if(typeof callback === 'function'){ callback(); }
        }
      });
    }else{
      self.master = false;
      self.processing = false;
      self.pollAgainLater();
      if(typeof callback === 'function'){ callback(); }
    }
  });
};

scheduler.prototype.pollAgainLater = function(){
  var self = this;
  if(self.running === true){
    self.timer = setTimeout(function(){
      self.poll();
    }, self.options.timeout);
  }
};

scheduler.prototype.masterKey = function(){
  var self = this;
  return self.connection.key('resque_scheduler_master_lock');
};

scheduler.prototype.tryForMaster = function(callback){
  var self = this;

  if(!self.connection || !self.connection.redis){
    return callback();
  }

  self.connection.redis.setnx(self.masterKey(), self.options.name, function(error, locked){
    if(error){ return callback(error); }
    else if(locked === true || locked === 1){
      self.connection.redis.expire(self.masterKey(), self.options.masterLockTimeout, function(error){
        return callback(error, true);
      });
    }else{
      self.connection.redis.get(self.masterKey(), function(error, value){
        if(error){ return callback(error); }
        else if(value === self.options.name){
          self.connection.redis.expire(self.masterKey(), self.options.masterLockTimeout, function(error){
            return callback(error, true);
          });
        }else{
          return callback(null, false);
        }
      });
    }
  });
};

scheduler.prototype.releaseMasterLock = function(callback){
  var self = this;
  if(self.connection){
    self.tryForMaster(function(error, isMaster){
      if(error){ return callback(error); }
      else if(!isMaster){ return callback(null, false); }
      else{
        self.connection.redis.del(self.masterKey(), function(error, delted){
          self.master = false;
          return callback(error, (delted === 1));
        });
      }
    });
  }else{
    return callback();
  }
};

scheduler.prototype.nextDelayedTimestamp = function(callback){
  var self = this;
  var time = Math.round(new Date().getTime() / 1000);
  self.connection.redis.zrangebyscore(self.connection.key('delayed_queue_schedule'), '-inf', time, 'limit', 0, 1, function(error, items){
    if(error || items === null || items.length === 0){
      return callback(error);
    }else{
      return callback(null, items[0]);
    }
  });
};

scheduler.prototype.enqueueDelayedItemsForTimestamp = function(timestamp, callback){
  var self = this;
  self.nextItemForTimestamp(timestamp, function(error, job){
    if(!error && job){
      self.transfer(timestamp, job, function(){
        self.enqueueDelayedItemsForTimestamp(timestamp, callback);
      });
    }else{
      return callback(error);
    }
  });
};

scheduler.prototype.nextItemForTimestamp = function(timestamp, callback){
  var self = this;
  var key = self.connection.key('delayed:' + timestamp);
  self.connection.redis.lpop(key, function(error, job){
    if(error){
      return callback(error);
    }else{
      self.connection.redis.srem(self.connection.key('timestamps:' + job), ('delayed:' + timestamp), function(error){
        self.cleanupTimestamp(timestamp, function(){
          if(error){
            return callback(error);
          }else{
            return callback(null, JSON.parse(job));
          }
        });
      });
    }
  });
};

scheduler.prototype.transfer = function(timestamp, job, callback){
  var self = this;
  self.queue.enqueue(job.queue, job['class'], job.args, function(error){
    if(error){ self.emit('error', error); }
    self.emit('transferred_job', timestamp, job);
    return callback();
  });
};

scheduler.prototype.cleanupTimestamp = function(timestamp, callback){
  var self = this;
  var key = self.connection.key('delayed:' + timestamp);
  self.connection.redis.llen(key, function(error, len){
    if(error){ return callback(error); }
    if(len === 0){
      self.connection.redis.del(key, function(error){
        if(error){ return callback(error); }
        self.connection.redis.zrem(self.connection.key('delayed_queue_schedule'), timestamp, function(error){
          return callback(error);
        });
      });
    }
    else{ return callback(); }
  });
};

exports.scheduler = scheduler;
