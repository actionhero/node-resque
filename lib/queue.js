var connection = require(__dirname + "/connection.js").connection;

var queue = function(options, callback){
  var self = this;
  self.options = options;
  self.connection = new connection(options.connection);
  self.connection.connect(function(){
    if(typeof callback == 'function'){ callback(); }
  });
}

queue.prototype.end = function(callback){
  var self = this;
  self.connection.redis.quit();
  process.nextTick(function(){
    callback();
  });
}

queue.prototype.enqueue = function(q, func, args, callback){
  var self = this;
  self.connection.redis.sadd(self.connection.key('queues'), q, function(){
    self.connection.redis.rpush(self.connection.key('queue', q), JSON.stringify({
      "class": func,
      args: args || []
    }), function(){
      if(typeof callback == "function"){ callback(); }
    });
  });
}

queue.prototype.enqueueAt = function(timestamp, q, func, args, callback){
  var self = this;
  var item = JSON.stringify({
    "class": func,
    queue: q,
    args: args || []
  });
  var rTimestamp = Math.round(timestamp / 1000); // assume timestamp is in ms
  self.connection.redis.rpush(self.connection.key("delayed:" + rTimestamp), item, function(){
    self.connection.redis.zadd(self.connection.key('delayed_queue_schedule'), rTimestamp, rTimestamp, function(){
      if(typeof callback == "function"){ callback(); }
    });
  });
};

queue.prototype.enqueueIn = function(time, q, func, args, callback){
  var self = this;
  var timestamp = (new Date().getTime()) + time;
  self.enqueueAt(timestamp, q, func, args, function(){
    if(typeof callback == "function"){ callback(); }
  });
}

queue.prototype.queues = function(callback){
  var self = this;
  self.connection.redis.smembers(self.connection.key('queues'), function(err, queues){
    callback(err, queues);
  });
}

queue.prototype.length = function(q, callback){
  var self = this;
  self.connection.redis.llen(self.connection.key('queue', q), function(err, length){
    callback(err, length);
  });
}

exports.queue = queue;