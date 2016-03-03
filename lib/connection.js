var util = require('util');
var EventEmitter = require('events').EventEmitter;

var connection = function(options){
  var self = this;
  var defaults = self.defaults();

  if(!options){ options = {}; }
  for(var i in defaults){
    if(options[i] === null || options[i] === undefined){
      options[i] = defaults[i];
    }
  }
  self.options = options;
  self.connected = false;
};

util.inherits(connection, EventEmitter);

connection.prototype.defaults = function(){
  return {
    pkg:       'ioredis',
    host:      '127.0.0.1',
    port:      6379,
    database:  0,
    namespace: 'resque',
  };
};

connection.prototype.connect = function(callback){
  var self = this;

  if(self.options.redis){

    self.redis = self.options.redis;
    self.redis.set(self.key('connection_test_key'), true, function(error){
      self.redis.get(self.key('connection_test_key'), function(err, data){
        if(err){
          self.connected = false;
          self.emit('error', err);
        }else{
          self.connected = true;
          if(typeof callback === 'function'){ callback(); }
        }
      });
    });

  }else{

    if(self.options.package && !self.options.pkg) {
      self.emit('Depreciation warning: You need to use \'pkg\' instead of \'package\'! Please update your configuration.');
      self.options.pkg = self.options.package;
    }
    var pkg = require(self.options.pkg);
    self.redis = pkg.createClient(self.options.port, self.options.host, self.options.options);

    var handleConnection = function(){
      if(self.connected === true){
        // nothing to do here; this is a reconnect
      }else{
        self.redis.select(self.options.database, function(err){
          if(err){
            self.connected = false;
            self.emit('error', err);
          }else{
            self.connected = true;
            if(typeof callback === 'function'){ callback(); }
          }
        });
      }
    };

    self.redis.on('connect', handleConnection);
    if(self.options.pkg === 'fakeredis'){ process.nextTick(handleConnection); }
  }

  self.redis.on('error', function(err){
    self.emit('error', err);
  });

  self.redis.on('end', function(){
    self.connected = false;
  });
};

connection.prototype.end = function(){
  var self = this;
  self.connected = false;
  // Only disconnect if we established the redis connection on our own.
  if (!self.options.redis && self.options.pkg !== 'fakeredis'){
    if(typeof self.redis.disconnect === 'function'){ self.redis.disconnect(); }
    else{ self.redis.quit(); }
  }
};

connection.prototype.key = function(){
  var args;
  args = 1 <= arguments.length ? [].slice.call(arguments, 0) : [];
  args.unshift(this.options.namespace);
  return args.join(":");
};

exports.connection = connection;
