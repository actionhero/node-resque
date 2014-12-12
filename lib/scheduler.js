// TODO: Locking like ruby does

var EventEmitter = require('events').EventEmitter;
var util         = require("util");
var connection   = require(__dirname + "/connection.js").connection;
var queue        = require(__dirname + "/queue.js").queue;

var scheduler = function(options, jobs, callback){
  var self = this;
  var defaults = self.defaults();
  for(var i in defaults){
    if(options[i] == null){
      options[i] = defaults[i];
    }
  }
  if(typeof jobs == 'function' && callback == null){
    callback = jobs;
    jobs = {};
  }
  self.options = options;
  self.connection = new connection(options.connection);
  self.running = false;
  self.connection.connect(function(err){
    self.queue = new queue({connection: options.connection}, jobs, function(err){
      if(typeof callback === 'function'){ callback(err); }
    });
  });
}

util.inherits(scheduler, EventEmitter);

scheduler.prototype.defaults = function(){
  var self = this;
  return {
    timeout: 5000,
  }
}

scheduler.prototype.start = function() {
  var self = this;
  if (!self.running) {
    self.emit('start')
    self.running = true;
    self.processing = false;
    self.timer = setTimeout((function() {
      self.poll();
    }), self.options.timeout);
  }
};

scheduler.prototype.end = function(callback) {
  var self = this;
  self.running = false;
  if(self.processing == false){
    clearTimeout(self.timer);
    self.emit('end');
    process.nextTick(function(){
      if(typeof callback === 'function'){ callback(); }
    });
  }else if(self.processing == true){
    setTimeout(function(){
      self.end(callback);
    }, (self.options.timeout / 2));
  }
};

scheduler.prototype.poll = function(callback) {
  var self = this;
  self.processing = true;
  clearTimeout(self.timer);
  self.emit('poll');
  self.nextDelayedTimestamp(function(err, timestamp){
    if(!err && timestamp){
      self.emit('working_timestamp', timestamp);
      self.enqueueDelayedItemsForTimestamp(timestamp, function(err){
        if(err){ self.emit('error', err); }
        self.poll(callback);
      });
    }else{
      if(err){ self.emit('error', err); }
      self.processing = false;
      if(self.running === true){
        self.timer = setTimeout((function() {
          self.poll();
        }), self.options.timeout);
      }
      if(typeof callback === 'function'){ callback(); }
    }
  });
};

scheduler.prototype.nextDelayedTimestamp = function(callback) {
  var self = this;
  var time = Math.round(new Date().getTime() / 1000);
  self.connection.redis.zrangebyscore(self.connection.key('delayed_queue_schedule'), '-inf', time, 'limit', 0, 1, function(err, items) {
    if (err || items === null || items.length === 0) {
      callback(err);
    } else {
      callback(null, items[0]);
    }
  });
};

scheduler.prototype.enqueueDelayedItemsForTimestamp = function(timestamp, callback) {
  var self = this;
  self.nextItemForTimestamp(timestamp, function(err, job){
    if (!err && job ) {
      self.transfer(timestamp, job, function(){
        self.enqueueDelayedItemsForTimestamp(timestamp, callback);
      });
    } else {
      callback(err);
    }
  });
};

scheduler.prototype.nextItemForTimestamp = function(timestamp, callback) {
  var self = this;
  var key = self.connection.key("delayed:" + timestamp);
  self.connection.redis.lpop(key, function(err, job){
    if(err){
      callback(err);
    }else{
      self.connection.redis.srem(self.connection.key("timestamps:" + job), key, function(err){
        self.cleanupTimestamp(timestamp, function(){
          if (err) {
            callback(err);
          } else {
            callback(null, JSON.parse(job));
          }
        });
      });
    }
  });
};

scheduler.prototype.transfer = function(timestamp, job, callback) {
  var self = this;
  self.queue.enqueue(job["queue"], job["class"], job.args, function(err){
    if(err){ self.emit('error', err); }
    self.emit('transferred_job', timestamp, job);
    callback();
  });
};

scheduler.prototype.cleanupTimestamp = function(timestamp, callback) {
  var self = this;
  var key = self.connection.key("delayed:" + timestamp);
  self.connection.redis.llen(key, function(err, len) {
    if (len === 0) {
      self.connection.redis.del(key);
      self.connection.redis.zrem(self.connection.key('delayed_queue_schedule'), timestamp);
    }
    callback();
  });
};

exports.scheduler = scheduler;