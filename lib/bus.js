var connection = require(__dirname + "/connection.js").connection;
var queue      = require(__dirname + "/queue.js").queue;

var bus = function(options, callback){
  var self = this;

  var defaults = self.defaults();
  for(var i in defaults){
    if(options[i] == null){
      options[i] = defaults[i];
    }
  }

  self.options = options;
  self.queueObject = new queue({connection: options.connection}, function(){
    self.connection = self.queueObject.connection;
    if(typeof callback == 'function'){ callback(); }
  });
}

bus.prototype.defaults = function(){
  return {
    incommigQueue:     "resquebus_incoming",
    busDriverClassKey: "::ResqueBus::Driver",
  }
}

bus.prototype.appPrefix = function(){
  return "resque:resquebus_app:";
}

bus.prototype.subscriptionSet = function(){
  return "resque:resquebus_apps";
}

bus.prototype.driverJob = function(){
  var self = this;
  return {
    plugins: [],
    pluginOptions: [],
    perform: function(args, callback){
      var started = 0;
      var published = 0;

      self.subscriptions(function(err, subscriptions){        
        for(var i in subscriptions){
          started++;
          var subscription = subscriptions[i];
          var matched = self.subscriptionMatch(args, subscription);
          if(matched === true){
            published++;
            self.queueObject.enqueue(subscription.queue_name, subscription.class, args, function(err, toRun){
              started--;
              if(started === 0 && typeof callback === 'function'){ callback(null, published); }
            });
          }else{
            process.nextTick(function(){
              started--;
              if(started === 0 && typeof callback === 'function'){ callback(null, published); }
            });
          }
        }
      });
    } 
  }
}

bus.prototype.subscriptionMatch = function(args, subscription){
  var specialPrepend = "bus_special_value_";
  var matched = true;
  var parts = 0;

  for(var key in subscription.matcher){
    parts++;
    var value = subscription.matcher[key];
    if(matched === true){
      if(value === specialPrepend + "key"){
        if( args[key] != null ){ matched = true; }
        else{ matched = false; }
      }
      else if(value === specialPrepend + "blank"){
        if( args[key] != null && args[key].trim().length == 0 ){ matched = true; }
        else{ matched = false; }
      }
      else if(value === specialPrepend + "empty"){
        if( args[key] == null ){ matched = true; }
        else{ matched = false; }
      }
      else if(value === specialPrepend + "nil"){
        if( args[key] === undefined ){ matched = true; }
        else{ matched = false; }
      }
      else if(value === specialPrepend + "value"){
        if( args[key] != null ){ matched = true; }
        else{ matched = false; }
      }
      else if(value === specialPrepend + "present"){
        if( args[key] != null && args[key].trim().length > 0 ){ matched = true; }
        else{ matched = false; }
      }
      else{
        var matches = args[key].match(new RegExp(value, 'g'));
        if (matches != null ){ matched = true; }
        else{ matched = false; }
      }
    }
  }

  if(parts === 0){
    matched = false;
  }

  return matched;
}

bus.prototype.subscriptions = function(callback){
  var self = this;
  var subscriptions = {};
  self.connection.redis.smembers(self.subscriptionSet(), function(err, applications){
    if(err != null || applications.length === 0){ 
      callback(err, subscriptions);
    }else{
      var started = 0;
      applications.forEach(function(app){
        started++;
        self.connection.redis.hgetall(self.appPrefix() + app , function(err, subscription){
          for(var i in subscription){
            subscriptions[i] = JSON.parse(subscription[i]);
          }
          started--;
          if(started === 0){
            callback(err, subscriptions);
          }
        });
      });
    }
  });
}

bus.prototype.subscribe = function(appKey, queue_name, job, matcher, callback){
  var self                  = this;    
  var key                   = appKey + "_" + queue_name + "_" + job + "_subscription";   
  var combined_queue_name   = appKey + "_" + queue_name;
  var subscription = { 
    queue_name : combined_queue_name,
    key        : key,
    class      : job,
    matcher    : matcher
  }
  self.connection.redis.hset(self.appPrefix() + appKey, key, JSON.stringify(subscription), function(err){
    self.connection.redis.sadd(self.subscriptionSet(), appKey, function(err){
      callback(err, combined_queue_name);
    });
  });
},

bus.prototype.unsubscribe = function(appKey, queue_name, callback){
  var self = this;
  var key  = appKey + "_" + queue_name + "_subscription";  
  self.connection.redis.hdel(self.appPrefix() + appKey, key, function(err){
    self.connection.redis.hkeys(self.appPrefix() + appKey, function(err, keys){
      if(keys.length == 0){
        self.unsubscribeAll(appKey, function(){
          callback();
        });
      }else{  
        callback();
      }
    });
  });
}

bus.prototype.unsubscribeAll = function(appKey, callback){
  var self = this;
  self.connection.redis.srem(self.subscriptionSet(), appKey, function(err){
    self.connection.redis.del(self.appPrefix() + appKey, function(err){
      callback();
    });
  });
}

bus.prototype.publish = function(payload, callback){
  var self = this;
  var queue = self.options.incommigQueue;
  var klass = self.options.busDriverClassKey;
  var args = [payload];

  self.queueObject.enqueue(queue, klass, args, function(err, toRun){
    if(typeof callback === 'function'){ callback(err, toRun); }
  });
}

bus.prototype.publishAt = function(timestamp, payload, callback){
  var self = this;
  var queue = self.options.incommigQueue;
  var klass = self.options.busDriverClassKey;
  var args = [payload];

  self.queueObject.enqueueAt(timestamp, queue, klass, args, function(){
    if(typeof callback === 'function'){ callback(); }
  });
}

bus.prototype.publishIn = function(time, payload, callback){
  var self = this;
  var timestamp = new Date().getTime() + time;
  self.publishAt(timestamp, payload, callback);
}

exports.bus = bus;