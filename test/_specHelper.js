var redis = require('ioredis');
var fakeredis = require('fakeredis');
var namespace = 'resque_test';
var queue = 'test_queue';

var pkg = 'ioredis';
if(process.env.FAKEREDIS === 'true'){ pkg = 'fakeredis';  }

console.log('Using ' + pkg);

exports.specHelper = {
  pkg: pkg,
  NR: require(__dirname + '/../index.js'),
  namespace: namespace,
  queue: queue,
  timeout: 500,
  connectionDetails: {
    pkg:       pkg,
    host:      '127.0.0.1',
    password:  '',
    port:      6379,
    database:  1,
    namespace: namespace,
    // looping: true
  },

  connect: function(callback){
    var self = this;
    if(pkg !== 'fakeredis'){
      self.redis = redis.createClient(self.connectionDetails.port, self.connectionDetails.host, self.connectionDetails.options);
      self.redis.setMaxListeners(0);
      if(self.connectionDetails.password !== null && self.connectionDetails.password !== ''){
        self.redis.auth(self.connectionDetails.password, function(err){
          self.redis.select(self.connectionDetails.database, function(err){
            // self.connectionDetails.redis = self.redis;
            callback(err);
          });
        });
      }else{
        self.redis.select(self.connectionDetails.database, function(err){
          self.connectionDetails.redis = self.redis;
          callback(err);
        });
      }
    }else{
      self.redis = fakeredis.createClient('test', 123, {fast: true});
      self.redis.setMaxListeners(0);
      self.redis.select(self.connectionDetails.database, function(err){
        process.nextTick(function(){
          self.connectionDetails.redis = self.redis;
          callback(err);
        });
      });
    }
  },

  cleanup: function(callback){
    var self = this;
    setTimeout(function(){
      self.redis.keys(self.namespace + '*', function(err, keys){
        if(keys.length === 0){
          callback();
        }else{
          self.redis.del(keys, function(){
            callback();
          });
        }
      });
    }, 200);
  },

  startAll: function(jobs, callback){
    var self = this;
    self.worker = new self.NR.worker({connection: {redis: self.redis}, queues: self.queue, timeout: self.timeout}, jobs, function(){
      self.scheduler = new self.NR.scheduler({connection: {redis: self.redis}, timeout: self.timeout}, function(){
        self.queue = new self.NR.queue({connection: {redis: self.redis}}, function(){
          callback();
        });
      });
    });
  },

  endAll: function(callback){
    var self = this;
    self.worker.end(function(){
      self.scheduler.end(function(){
        callback();
      });
    });
  },

  popFromQueue: function(callback){
    var self = this;
    self.redis.lpop(self.namespace + ':queue:' + self.queue, function(err, obj){
      callback(err, obj);
    });
  },

  cleanConnectionDetails: function(){
    var self = this;
    var out = {};
    if(self.pkg === 'fakeredis'){
      return self.connectionDetails;
    }
    for(var i in self.connectionDetails){
      if(i !== 'redis'){
        out[i] = self.connectionDetails[i];
      }
    }

    return out;
  }
};
