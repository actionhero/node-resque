// I am an example of running multiple node-resque workers in a single process, auto-scaling with CPU utilization

var NR = require(__dirname + "/../index.js");
var os = require('os');

var connectionDetails = {
  package:   "redis",
  host:      "127.0.0.1",
  password:  "",
  port:      6379,
  database:  0,
  // namespace: "resque",
  // looping: true
}

var minWorkers     = 1;
var maxWorkers     = 100;
var checkTimeout   = 1000;
var workers        = [];
var maxLoopDelay   = 10;
var checkTimer;

var eventLoopDelay = function(callback){
  var start = Date.now();
  setImmediate(function(){
    var delay = Date.now() - start;
    callback(delay);
  });
}

var blockingSleep = function(naptime){
  var sleeping = true;
  var now = new Date();
  var alarm;
  var startingMSeconds = now.getTime();
  while(sleeping){
    alarm = new Date();
    var alarmMSeconds = alarm.getTime();
    if(alarmMSeconds - startingMSeconds > naptime){ sleeping = false }
  }
}

//////////////////////////////
// DEFINE YOUR WORKER TASKS //
//////////////////////////////

var jobsToComplete = 0;
var jobs = {
  "slowSleepJob": {
    plugins: [],
    pluginOptions: {},
    perform: function(callback){
      setTimeout(function(){
        callback(null, new Date().getTime() );
      }, 1000);
    },
  },
  "slowCPUJob": {
    plugins: [],
    pluginOptions: {},
    perform: function(callback){
      blockingSleep(1000);
      callback(null, new Date().getTime() );
    },
  },
};

var startWorker = function(callback){
  var id = (workers.length + 1);
  var worker = new NR.worker({
      connection: connectionDetails, 
      queues: ['slowQueue'],
      name: os.hostname() + ":" + process.pid + '+' + id
  }, jobs, function(){
    worker.workerCleanup(); // optional: cleanup any previous improperly shutdown workers
    worker.start();
    callback();
  });

  worker.id = id;

  worker.on('start',           function(){                    console.log("worker["+worker.id+"] started"); })
  worker.on('end',             function(){                    console.log("worker["+worker.id+"] ended"); })
  worker.on('cleaning_worker', function(worker, pid){         console.log("cleaning old worker " + worker); })
  worker.on('poll',            function(queue){               console.log("worker["+worker.id+"] polling " + queue); })
  worker.on('job',             function(queue, job){          console.log("worker["+worker.id+"] working job " + queue + " " + JSON.stringify(job)); })
  worker.on('reEnqueue',       function(queue, job, plugin){  console.log("worker["+worker.id+"] reEnqueue job (" + plugin + ") " + queue + " " + JSON.stringify(job)); })
  worker.on('success',         function(queue, job, result){  console.log("worker["+worker.id+"] job success " + queue + " " + JSON.stringify(job) + " >> " + result); })
  worker.on('failure',         function(queue, job, failure){ console.log("worker["+worker.id+"] job failure " + queue + " " + JSON.stringify(job) + " >> " + failure); })
  worker.on('error',           function(queue, job, error){   console.log("worker["+worker.id+"] error " + queue + " " + JSON.stringify(job) + " >> " + error); })
  worker.on('pause',           function(){                    console.log("worker["+worker.id+"] paused"); })

  workers.push(worker);
}

var checkWorkers = function(callback){
  var verb;
  var workingCount = 0;
  eventLoopDelay(function(delay){

    workers.forEach(function(worker){
      if(worker.working === true){ workingCount++; }
    });

    if(delay > maxLoopDelay && workers.length > minWorkers){  verb = '-'; }
    else if(delay > maxLoopDelay && workers.length == minWorkers){ verb = 'x'; }
    else if(delay < maxLoopDelay && workers.length == maxWorkers){ verb = 'x'; }
    else if(delay < maxLoopDelay && workers.length < minWorkers){  verb = '+'; }
    else if(
      delay < maxLoopDelay && 
      workers.length < maxWorkers && 
      (
        workers.length === 0 || 
        workingCount / workers.length > 0.5
      ) 
    ){ verb = '+'; }
    else if(
      delay < maxLoopDelay && 
      workers.length > minWorkers && 
      workingCount / workers.length < 0.5
    ){
      verb = '-';
    }
    else{ verb = 'x'; }

    if(verb === 'x'){ callback(null, verb, delay); }
    if(verb === '-'){
      var worker = workers.pop();
      worker.end(function(err){
        callback(err, verb, delay);
      });
    }
    if(verb === '+'){
      startWorker(function(err){
        callback(err, verb, delay);
      });
    }
  });
}

checkWraper = function(){
  clearTimeout(checkTimer);
  checkWorkers(function(err, verb, delay){
    if(err){ console.log(err); }
    console.log("*** checked for worker status: " + verb + " (event loop delay: " + delay + "ms)");
    checkTimer = setTimeout(function(){
      checkWraper();
    }, checkTimeout);
  });
}

var queue = new NR.queue({connection: connectionDetails}, jobs, function(){
  checkWraper();

  var i = 0;
  while(i < 10){
    queue.enqueue('slowQueue', "slowCPUJob", []);
    i++;
  }

  var i = 0;
  while(i < 1000){
    queue.enqueue('slowQueue', "slowSleepJob", []);
    i++;
  }
});