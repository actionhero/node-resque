var util  = require('util');
var async = require('async');
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
  self.listeners = {};
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
    var jobs = [];
    self.redis = self.options.redis;

    jobs.push(function(done){
      self.redis.set(self.key('connection_test_key'), 'true', done);
    });

    jobs.push(function(done){
      self.redis.get(self.key('connection_test_key'), function(error, data){
        if(!error && data !== 'true'){ error = new Error('cannot read connection test key'); }
        if(error){
          self.connected = false;
          self.emit('error', error);
          return done(error);
        }
        self.connected = true;
        done();
      });
    });

    async.series(jobs, callback);
  }else{

    if(self.options['package'] && !self.options.pkg){
      self.emit('Depreciation warning: You need to use \'pkg\' instead of \'package\'! Please update your configuration.');
      self.options.pkg = self.options['package'];
    }
    var pkg = require(self.options.pkg);
    self.redis = pkg.createClient(self.options.port, self.options.host, self.options.options);

    self.listeners.connect = function(){
      if(self.connected === true){
        // nothing to do here; this is a reconnect
      }else{
        self.redis.select(self.options.database, function(error){
          if(error){
            self.connected = false;
            self.emit('error', error);
            return callback(error);
          }else{
            self.connected = true;
            return callback();
          }
        });
      }
    };

    self.redis.on('connect', self.listeners.connect);
    if(self.options.pkg === 'fakeredis'){ process.nextTick(self.listeners.connect); }
  }

  self.listeners.error = function(error){ self.emit('error', error); };
  self.redis.on('error', self.listeners.error);

  self.listeners.end = function(){ self.connected = false; };
  self.redis.on('end', self.listeners.end);
};

connection.prototype.end = function(){
  var self = this;
  self.connected = false;

  Object.keys(self.listeners).forEach(function(eventName){
    self.redis.removeListener(eventName, self.listeners[eventName]);
  });

  // Only disconnect if we established the redis connection on our own.
  if(!self.options.redis && self.options.pkg !== 'fakeredis'){
    if(typeof self.redis.disconnect === 'function'){ self.redis.disconnect(); }
    else{ self.redis.quit(); }
  }
};

connection.prototype.key = function(){
  var args;
  args = (arguments.length >= 1 ? [].slice.call(arguments, 0) : []);
  args.unshift(this.options.namespace);
  return args.join(':');
};

exports.connection = connection;
