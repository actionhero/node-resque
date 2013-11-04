var connection = function(options){
  var self = this;
  var defaults = self.defaults();
  for(var i in defaults){
    if(options[i] == null){
      options[i] = defaults[i];
    }
  }
  self.options = options;
}

connection.prototype.defaults = function(){
  return {
    package:   require("redis"),
    host:      "127.0.0.1",
    password:  "",
    port:      6379,
    database:  0,
    namespace: "resque",
  }
}

connection.prototype.connect = function(callback){
  var self = this;
  var options = self.options;
  self.redis = options.package.createClient(options.port, options.host, options.options);
  if(options.password != null && options.password != "" && self.options.fake != true){
    self.redis.auth(options.password, function(err){
      self.redis.select(options.database, function(err){
        callback(err);
      });
    }); 
  }else if(self.options.fake != true){
    self.redis.select(options.database, function(err){
      callback(err);
    });
  }else{
    process.nextTick(function(){ callback(); });
  }
}

connection.prototype.disconnect = function(){
  var self = this;
  return self.redis.quit();
}

connection.prototype.key = function(){
  var args;
  args = 1 <= arguments.length ? [].slice.call(arguments, 0) : [];
  args.unshift(this.options.namespace);
  return args.join(":");
}

exports.connection = connection;