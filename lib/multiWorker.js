var os = require('os');
var util = require("util");
var EventEmitter = require('events').EventEmitter;
var Worker = require(__dirname + "/worker.js").worker;

var multiWorker = function(options, jobs, callback){
  var self = this;
  var defaults = self.defaults();
  for(var i in defaults){
    if(options[i] == null){
      options[i] = defaults[i];
    }
  }
  self.workers = [];
  self.options = options;
  self.jobs = jobs;
  self.running = false;
  self.working = false;
  process.nextTick(function(){ 
    callback(); 
  });
}

util.inherits(multiWorker, EventEmitter);

multiWorker.prototype.defaults = function(){
  var self = this;
  // all times in ms
  return {
    minTaskProcessors:   1,
    maxTaskProcessors:   100,
    timeout:             5000,
    checkTimeout:        500,
    maxEventLoopDelay:   10,
    toDisconnectProcessors: true,
  }
}

multiWorker.prototype.eventLoopDelay = function(callback){
  var start = Date.now();
  setImmediate(function(){
    callback(null, (Date.now() - start));
  });
}

multiWorker.prototype.startWorker = function(callback){
  var self = this;
  var id = (self.workers.length + 1);
  var worker = new Worker({
      connection: self.options.connection, 
      queues: self.options.queues,
      timeout: self.options.timeout,
      name: os.hostname() + ":" + process.pid + '+' + id
  }, self.jobs, function(){
    worker.workerCleanup();
    worker.start();
    process.nextTick(callback);
  });

  worker.id = id;

  worker.on('start',           function(){                    self.emit('start', worker.id);                         })
  worker.on('end',             function(){                    self.emit('end', worker.id);                           })
  worker.on('cleaning_worker', function(worker, pid){         self.emit('cleaning_worker', worker.id, worker, pid);  })
  worker.on('poll',            function(queue){               self.emit('poll', worker.id, queue);                   })
  worker.on('job',             function(queue, job){          self.emit('job', worker.id, queue, job);               })
  worker.on('reEnqueue',       function(queue, job, plugin){  self.emit('reEnqueue', worker.id, queue, job, plugin); })
  worker.on('success',         function(queue, job, result){  self.emit('success', worker.id, queue, job, result);   })
  worker.on('failure',         function(queue, job, failure){ self.emit('failure', worker.id, queue, job, failure);  })
  worker.on('error',           function(queue, job, error){   self.emit('error', worker.id, queue, job, error);      })
  worker.on('pause',           function(){                    self.emit('pause', worker.id);                         })

  self.workers.push(worker);
}

multiWorker.prototype.checkWorkers = function(callback){
  var self = this;
  var verb;
  var workingCount = 0;
  self.eventLoopDelay(function(err, delay){

    self.workers.forEach(function(worker){
      if(worker.working === true){ workingCount++; }
    });

    if(workingCount > 0){
      self.working = true;
    }else{
      self.working = false;
    }

         if(self.running === false && self.workers.length > 0){                                               verb = '--'; }
    else if(self.running === false && self.workers.length === 0){                                             verb = 'x'; }
    else if(delay > self.options.maxEventLoopDelay && self.workers.length > self.options.minTaskProcessors){  verb = '-'; }
    else if(delay > self.options.maxEventLoopDelay && self.workers.length == self.options.minTaskProcessors){ verb = 'x'; }
    else if(delay < self.options.maxEventLoopDelay && self.workers.length == self.options.maxTaskProcessors){ verb = 'x'; }
    else if(delay < self.options.maxEventLoopDelay && self.workers.length < self.options.minTaskProcessors){  verb = '+'; }
    else if(
      delay < self.options.maxEventLoopDelay && 
      self.workers.length < self.options.maxTaskProcessors && 
      (
        self.workers.length === 0 || 
        workingCount / self.workers.length > 0.5
      ) 
    ){ verb = '+'; }
    else if(
      delay < self.options.maxEventLoopDelay && 
      self.workers.length > self.options.minTaskProcessors && 
      workingCount / self.workers.length < 0.5
    ){
      verb = '-';
    }
    else{ verb = 'x'; }

    if(verb === 'x'){ callback(null, verb, delay); }
    if(verb === '-'){
      var worker = self.workers.pop();
      worker.end(function(err){
        self.cleanupWorker(worker);
        callback(err, verb, delay);
      });
    }
    if(verb === '--'){
      var touched = 0;
      if(self.workers.length === 0){ callback(err, verb, delay); }
      self.workers.forEach(function(worker){
        touched++
        worker.end(function(err){
          touched--;
          self.cleanupWorker(worker);
          if(touched === 0){ 
            self.workers = [];
            callback(err, verb, delay); 
          }
        });
      });
    }
    if(verb === '+'){
      self.startWorker(function(err){
        callback(err, verb, delay);
      });
    }
  });
}

multiWorker.prototype.cleanupWorker = function(worker){
  var self = this;

  [
    'start',
    'end',
    'cleaning_worker',
    'poll',
    'job',
    'reEnqueue',
    'success',
    'failure',
    'error',
    'pause',
    'internalError',
    'multiWorkerAction',
  ].forEach(function(e){
    worker.removeAllListeners(e);
  });

  if(self.options.toDisconnectProcessors === true){
    worker.connection.redis.quit();
  }
}

multiWorker.prototype.checkWraper = function(){
  var self = this;
  clearTimeout(self.checkTimer);
  self.checkWorkers(function(err, verb, delay){
    if(err){ self.emit('internalError', err); }
    self.emit('multiWorkerAction', verb, delay);
    self.checkTimer = setTimeout(function(){
      self.checkWraper();
    }, self.options.checkTimeout);
  });
}

multiWorker.prototype.start = function(callback){
  var self = this;
  self.running = true;
  self.checkWraper();
  process.nextTick(function(){
    if(typeof callback === 'function'){ callback(); }
  });
}

multiWorker.prototype.stop = function(callback){
  var self = this;
  self.running = false;
  self.stopWait(callback);
}

multiWorker.prototype.end = function(callback){
  var self = this;
  self.stop(callback);
}

multiWorker.prototype.stopWait = function(callback){
  var self = this;
  if(self.workers.length === 0 && self.working === false){ 
    clearTimeout(self.checkTimer);
    setTimeout(function(){
      if(typeof callback === 'function'){ callback(); }
    }, self.options.checkTimeout * 2)
  }else{
    setTimeout(function(){
      self.stopWait(callback);
    }, self.options.checkTimeout)
  }
}

exports.multiWorker = multiWorker;
