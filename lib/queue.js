var connection = require(__dirname + "/connection.js").connection;

var queue = function(options, callback){
  var self = this;
  self.options = options;
  self.connection = new connection(options.connection);
  self.connection.connect(function(){
    if(typeof callback == 'function'){ callback(); }
  });
}

queue.prototype.enqueue = function(func, args){
  var self = this;
  var queue = self.options.queue;
  self.connection.redis.sadd(self.connection.key('queues'), queue);
  self.connection.redis.rpush(self.connection.key('queue', queue), JSON.stringify({
    "class": func,
    args: args || []
  }));
}

queue.prototype.enqueueAt = function(timestamp, func, args){
  var self = this;
  var item = JSON.stringify({
    "class": func,
    queue: self.options.queue,
    args: args || []
  });
  var rTimestamp = Math.round(timestamp / 1000); // assume timestamp is in ms
  self.connection.redis.rpush(self.connection.key("delayed:" + rTimestamp), item);
  self.connection.redis.zadd(self.connection.key('delayed_queue_schedule'), rTimestamp, rTimestamp);
};

queue.prototype.enqueueIn = function(time, func, args){
  var self = this;
  var timestamp = (new Date().getTime()) + time;
  self.enqueueAt(timestamp, func, args);
}

queue.prototype.queues = function(callback){
  var self = this;
  self.connection.redis.smembers(self.connection.key('queues'), function(err, queues){
    callback(err, queues);
  });
}

queue.prototype.length = function(callback){
  var self = this;
  var queue = self.options.queue;
  self.connection.redis.llen(self.connection.key('queue', queue), function(err, length){
    callback(err, length);
  });
}

exports.queue = queue;