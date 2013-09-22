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
  return self.connection.redis.rpush(self.connection.key('queue', queue), JSON.stringify({
    "class": func,
    args: args || []
  }));
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