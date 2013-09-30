// TODO: Locking like ruby does

var EventEmitter = require('events').EventEmitter;
var util         = require("util");
var connection   = require(__dirname + "/connection.js").connection;
var queue        = require(__dirname + "/queue.js").queue;

var scheduler = function(options, callback){
  var self = this;
  var defaults = self.defaults();
  for(var i in defaults){
    if(options[i] == null){
      options[i] = defaults[i];
    }
  }
  self.options = options;
  self.connection = new connection(options.connection);
  self.running = false;
  self.connection.connect(function(){
    if(typeof callback == 'function'){ callback(); }
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
    self.emit("start")
    self.running = true;
    self.interval = setInterval((function() {
      self.poll();
    }), self.options.timeout);
  }
};

scheduler.prototype.end = function(callback) {
  var self = this;
  if(self.running == true){
    clearInterval(self.interval);
    self.interval = null;
    self.running = false;
    setTimeout(function(){
      self.emit('end');
      callback(); 
    }, self.options.timeout * 2) // TODO: Janky, but should ensure that process is complete
  }
};

scheduler.prototype.poll = function(callback) {
  var self = this;
  self.emit("poll");
  self.nextDelayedTimestamp(function(err, timestamp){
    if (!err && timestamp) {
      self.enqueueDelayedItemsForTimestamp(timestamp, function(err) {
        if (err == null) { self.poll(); }
        else{ 
          if(typeof callback === "function"){ callback(); }
        }
      });
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
  self.emit("working_timestamp", timestamp);
  self.nextItemForTimestamp(timestamp, function(err, job){
    if (!err && job ) {
      self.transfer(timestamp, job, function(){
        self.nextItemForTimestamp(timestamp, callback);
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
    self.cleanupTimestamp(timestamp);
    if (err) {
      callback(err);
    } else {
      callback(false, JSON.parse(job));
    }
  });
};

scheduler.prototype.transfer = function(timestamp, job, callback) {
  var self = this;
  var q = new queue({connection: self.options.connection}, function(){
    q.enqueue(job["queue"], job["class"], job.args, function(){
      self.emit("transfered_job", timestamp, job);
      q.end(function(){
        callback();
      });
    });
  });
};

scheduler.prototype.cleanupTimestamp = function(timestamp) {
  var self = this;
  var key = self.connection.key("delayed:" + timestamp);
  self.connection.redis.llen(key, function(err, len) {
    if (len === 0) {
      self.connection.redis.del(key);
      self.connection.redis.zrem(self.connection.key('delayed_queue_schedule'), timestamp);
    }
  });
};

exports.scheduler = scheduler;