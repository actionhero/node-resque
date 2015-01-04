var connection = function(options){
  var self = this;
  var defaults = self.defaults();

  if(!options){ options = {}; }
  for(var i in defaults){
    if(options[i] == null){
      options[i] = defaults[i];
    }
  }
  self.options   = options;
  if(options.redis == null){
    self.connected = false;
  }else{
    // already connected, so the 'connect' event won't be fired
    // we need another test
    self.connected = true;
    options.redis.get('key', function(err, data){
      if(err){ self.connected = false; }
    })
  }
  
}

connection.prototype.defaults = function(){
  return {
    package:   "redis",
    host:      "127.0.0.1",
    password:  "",
    port:      6379,
    database:  0,
    namespace: "resque",
  }
}

connection.prototype.ensureConnected = function(parentCallback, callack){
  var self = this;
  if(self.options.package === 'fakeredis'){
    callack();
  }else if(self.connected === false){
    var err = new Error('not connected to redis');
    if(typeof parentCallback === 'function'){
      parentCallback( new Error('not connected to redis') );
    }else{
      throw err; 
    }
  }else{
    callack();
  }
}

connection.prototype.connect = function(callback){
  var self = this;
  var options = self.options;
  var package = require(self.options.package)
  if(options.redis ){
    self.redis = options.redis;
  }else{
    self.redis = package.createClient(options.port, options.host, options.options);
  }
  
  if(options.password != null && options.password != "" && self.options.fake != true){
    try{ self.redis.auth(options.password); }catch(e){ }
  }
  
  self.redis.on('error', function(err){
    if(self.connected === false){
      callback(err);
    }
    // catch to prevent bubble up of error
  });
  
  self.redis.on('connect', function(){
    if(options.password != null && options.password != "" && self.options.fake != true){
      self.redis.auth(options.password);
    }
    self.connected = true;
    if(self.options.package != 'fakeredis'){
      self.redis.select(options.database, function(err){
        self.redis.info(function(err, data){
          callback(err); 
        });
      });
    }
  });
  
  self.redis.on('end', function(){
    self.connected = false;
  });
  
  if(self.options.package === 'fakeredis' || ( self.options.redis != null && self.options.redis.connected === true )){
    if(options.database != null){ self.redis.select(options.database); }
    process.nextTick(function(){
      callback(); 
    });
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
