var redis = require('redis');
var namespace = "resque_test";
var queue = "test_queue";

exports.specHelper = {
  NR: require(__dirname + "/../index.js"),
  namespace: namespace,
  queue: queue,
  timeout: 500,
  connectionDetails: {
    host:      "127.0.0.1",
    password:  "",
    port:      6379,
    database:  1,
    namespace: namespace,
    // looping: true
  },
  connect: function(callback){
    var self = this;
    self.redis = redis.createClient(self.connectionDetails.port, self.connectionDetails.host, self.connectionDetails.options);
    if(self.connectionDetails.password != null && self.connectionDetails.password != ""){
      self.redis.auth(self.connectionDetails.password, function(err){
        self.redis.select(self.connectionDetails.database, function(err){
          callback(err);
        });
      }); 
    }else{
      self.redis.select(self.connectionDetails.database, function(err){
        callback(err);
      });
    }
  },
  cleanup: function(callback){
    var self = this;
    self.redis.keys(self.namespace + "*", function(err, keys){
      if(keys.length == 0){ 
        callback(); 
      }else{
        self.redis.del(keys, function(){
          callback();
        });
      }
    });
  },
  startAll: function(jobs, callback){
    var self = this;
    self.worker = new self.NR.worker({connection: self.connectionDetails, queues: self.queue, timeout: self.timeout}, jobs, function(){
      self.scheduler = new self.NR.scheduler({connection: self.connectionDetails, timeout: self.timeout}, function(){
        self.queue = new self.NR.queue({connection: self.connectionDetails}, function(){
          callback();
        });
      });
    });
  },
  endAll: function(callback){
    var self = this;
    self.worker.end(function(){
      self.scheduler.end(function(){
        callback()
      })
    });
  },
  popFromQueue: function(callback){
    var self = this;
    self.redis.lpop(self.namespace + ":queue:" + self.queue, function(err, obj){
      callback(err, obj)
    });
  }
}