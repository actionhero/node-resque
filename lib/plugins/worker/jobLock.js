// If a job with the same queue, name, and args is already running, put this job back in the queue and try later

// var jobs = function(job, callback){
//   worker.runWith('jobLock', function(){
//     // biz logic here
//     callback();
//   });
// }

var jobLock = function(worker, job, callback){
  var self = this;
  self.worker = worker;
  self.job = job;
  self.callback = callback;
}

jobLock.prototype.lock_timeout = function(){
  return 3600 // in seconds
}

jobLock.prototype.lock = function(){
  var self = this;
  return self.worker.connection.key('lock', self.worker.queue, self.job.class, self.job.args.sort().join("-"));
}

jobLock.prototype.run = function(){
  var self = this;
  var key = self.lock();
  var now = Math.round(new Date().getTime() / 1000);
  var timeout = now + self.lock_timeout() + 1;
  self.worker.connection.redis.setnx(key, timeout, function(err, setCallback){
    if(setCallback === true || setCallback === 1){
      self.callback(null, true);
    }else{
      self.worker.connection.redis.get(key, function(err, redisTimeout){
        redisTimeout = parseInt(redisTimeout);
        if(now <= redisTimeout){
          self.callback(null, false);
        }else{  
          self.worker.connection.redis.set(key, timeout, function(err){
            self.worker.connection.redis.get(key, function(err, redisTimeout){
              redisTimeout = parseInt(redisTimeout);
              if(now > redisTimeout){
                self.callback(null. true);
              }else{
                self.callback(null, false);
              }
            });
          });
        }
      });
    }
  });
}

jobLock.prototype.jobComplete = function(callback){
  var self = this;
  var key = self.lock();
  self.worker.connection.redis.del(key, function(err){
    callback();
  });
}

exports.jobLock = jobLock;