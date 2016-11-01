var os = require('os');
var util = require('util');
var async = require('async');
var EventEmitter = require('events').EventEmitter;
var Worker = require(__dirname + '/worker.js').worker;
var eventLoopDelay = require(__dirname + '/eventLoopDelay');

var multiWorker = function(options, jobs){
  var self = this;

  var defaults = self.defaults();
  for(var i in defaults){
    if(options[i] === null || options[i] === undefined){
      options[i] = defaults[i];
    }
  }

  if(options.connection.redis && typeof options.connection.redis.setMaxListeners === 'function'){
    options.connection.redis.setMaxListeners(options.connection.redis.getMaxListeners() + options.maxTaskProcessors);
  }

  self.workers = [];
  self.options = options;
  self.jobs = jobs;
  self.running = false;
  self.working = false;
  self.name = self.options.name;
  self.eventLoopBlocked = true;
  self.eventLoopDelay = Infinity;
  self.eventLoopCheckCounter = 0;

  eventLoopDelay(
    self.options.maxEventLoopDelay,
    self.options.checkTimeout,
  function(blocked, ms){
    self.eventLoopBlocked = blocked;
    self.eventLoopDelay = ms;
    self.eventLoopCheckCounter++;
  });
};

util.inherits(multiWorker, EventEmitter);

multiWorker.prototype.defaults = function(){
  var self = this;
  // all times in ms
  return {
    minTaskProcessors:   1,
    maxTaskProcessors:   10,
    timeout:             5000,
    checkTimeout:        500,
    maxEventLoopDelay:   10,
    toDisconnectProcessors: true,
    name: os.hostname()
  };
};

multiWorker.prototype.startWorker = function(callback){
  var self = this;
  var id = (self.workers.length + 1);
  var worker = new Worker({
    connection: self.options.connection,
    queues:     self.options.queues,
    timeout:    self.options.timeout,
    name:       self.options.name + ':' + process.pid + '+' + id
  }, self.jobs);
  worker.connect(function(error){
    if(error){ self.emit('error', error); }
    worker.workerCleanup(function(error){
      worker.start();
      if(error){ self.emit('error', error); }
      process.nextTick(callback);
    });
  });

  worker.id = id;

  worker.on('start',           function(){                    self.emit('start', worker.id);                         });
  worker.on('end',             function(){                    self.emit('end', worker.id);                           });
  worker.on('cleaning_worker', function(worker, pid){         self.emit('cleaning_worker', worker.id, worker, pid);  });
  worker.on('poll',            function(queue){               self.emit('poll', worker.id, queue);                   });
  worker.on('job',             function(queue, job){          self.emit('job', worker.id, queue, job);               });
  worker.on('reEnqueue',       function(queue, job, plugin){  self.emit('reEnqueue', worker.id, queue, job, plugin); });
  worker.on('success',         function(queue, job, result){  self.emit('success', worker.id, queue, job, result);   });
  worker.on('failure',         function(queue, job, failure){ self.emit('failure', worker.id, queue, job, failure);  });
  worker.on('error',           function(queue, job, error){   self.emit('error', worker.id, queue, job, error);      });
  worker.on('pause',           function(){                    self.emit('pause', worker.id);                         });

  self.workers.push(worker);
};

multiWorker.prototype.checkWorkers = function(callback){
  var self = this;
  var verb;
  var workingCount = 0;

  setImmediate(function(){

    self.workers.forEach(function(worker){
      if(worker.working === true){ workingCount++; }
    });

    if(workingCount > 0){
      self.working = true;
    }else{
      self.working = false;
    }

    if(self.running === false && self.workers.length > 0){                                     verb = '--'; }
    else if(self.running === false && self.workers.length === 0){                              verb = 'x';  }
    else if(self.eventLoopBlocked  && self.workers.length > self.options.minTaskProcessors){   verb = '-';  }
    else if(self.eventLoopBlocked  && self.workers.length === self.options.minTaskProcessors){ verb = 'x';  }
    else if(!self.eventLoopBlocked && self.workers.length < self.options.minTaskProcessors){   verb = '+';  }
    else if(
      !self.eventLoopBlocked &&
      self.workers.length < self.options.maxTaskProcessors &&
      (
        self.workers.length === 0 ||
        workingCount / self.workers.length > 0.5
      )
    ){ verb = '+'; }
    else if(
      !self.eventLoopBlocked &&
      self.workers.length > self.options.minTaskProcessors &&
      workingCount / self.workers.length < 0.5
    ){
      verb = '-';
    }
    else{ verb = 'x'; }

    if(verb === 'x'){ return callback(null, verb, self.eventLoopDelay); }

    if(verb === '-'){
      var worker = self.workers.pop();
      worker.end(function(error){
        self.cleanupWorker(worker);
        return callback(error, verb, self.eventLoopDelay);
      });
    }

    if(verb === '--'){
      var jobs = [];

      var stopWorker = function(worker){
        jobs.push(function(done){
          worker.end(function(error){
            if(error){ return done(error); }
            self.cleanupWorker(worker);
            done();
          });
        });
      };

      while(self.workers.length > 0){
        var worker = self.workers.pop();
        stopWorker(worker);
      }

      async.parallel(jobs, function(error){
        self.workers = [];
        callback(error, verb, self.eventLoopDelay);
      });
    }

    if(verb === '+'){
      self.startWorker(function(error){
        callback(error, verb, self.eventLoopDelay);
      });
    }
  });
};

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
    worker.connection.end();
  }
};

multiWorker.prototype.checkWraper = function(callback){
  var self = this;
  clearTimeout(self.checkTimer);
  self.checkWorkers(function(error, verb, delay){
    if(error){ self.emit('internalError', error); }
    self.emit('multiWorkerAction', verb, delay);
    self.checkTimer = setTimeout(function(){
      self.checkWraper();
    }, self.options.checkTimeout);
    if(typeof callback === 'function'){ callback(); }
  });
};

multiWorker.prototype.start = function(callback){
  var self = this;
  self.running = true;
  self.checkWraper(function(){
    if(typeof callback === 'function'){ callback(); }
  });
};

multiWorker.prototype.stop = function(callback){
  var self = this;
  self.running = false;
  self.stopWait(callback);
};

multiWorker.prototype.end = function(callback){
  var self = this;
  self.stop(callback);
};

multiWorker.prototype.stopWait = function(callback){
  var self = this;
  if(self.workers.length === 0 && self.working === false){
    clearTimeout(self.checkTimer);
    process.nextTick(function(){
      if(typeof callback === 'function'){ callback(); }
    });
  }else{
    setTimeout(function(){
      self.stopWait(callback);
    }, self.options.checkTimeout);
  }
};

exports.multiWorker = multiWorker;
