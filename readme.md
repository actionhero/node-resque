# actionQueue
Delayed Tasks in nodejs.  A very opinionated but compatible API with [resque](https://github.com/resque/resque) and [resque scheduler](https://github.com/resque/resque-scheduler)

[![Build Status](https://secure.travis-ci.org/evantahler/action_resque.png?branch=master)](http://travis-ci.org/evantahler/action_resque)

## Usage

I learn best by examples:

```javascript
/////////////////////////
// REQUIRE THE PACKAGE //
/////////////////////////

var AR = require("action_resque");

///////////////////////////
// SET UP THE CONNECTION //
///////////////////////////

var connectionDetails = {
  host:      "127.0.0.1",
  password:  "",
  port:      6379,
  database:  0,
}

//////////////////////////////
// DEFINE YOUR WORKER TASKS //
//////////////////////////////

var jobs = {
  add: function(a,b,callback){
    jobsToComplete--;
    shutdown();
    callback(a + b);
  },
  subtract: function(a,b,callback){
    jobsToComplete--;
    shutdown();
    callback(a - b);
  },
};

////////////////////
// START A WORKER //
////////////////////

var worker = new AR.worker({connection: connectionDetails, queues: 'math'}, jobs, function(){
  worker.workerCleanup(); // optional: cleanup any previous improperly shutdown workers
  worker.start();
});

///////////////////////
// START A SCHEDULER //
///////////////////////

var scheduler = new AR.scheduler({connection: connectionDetails}, function(){
  scheduler.start();
});

/////////////////////////
// REGESTER FOR EVENTS //
/////////////////////////

worker.on('start',           function(){ console.log("worker started"); })
worker.on('end',             function(){ console.log("worker ended"); })
worker.on('cleaning_worker', function(worker, pid){ console.log("cleaning old worker " + worker); })
worker.on('poll',            function(queue){ console.log("worker polling " + queue); })
worker.on('job',             function(queue, job){ console.log("working job " + queue + " " + JSON.stringify(job)); })
worker.on('success',         function(queue, job, result){ console.log("job success " + queue + " " + JSON.stringify(job) + " >> " + result); })
worker.on('error',           function(queue, job, error){ console.log("job failed " + queue + " " + JSON.stringify(job) + " >> " + error); })
worker.on('pause',           function(){ console.log("worker paused"); })

scheduler.on('start',             function(){ console.log("scheduler started"); })
scheduler.on('end',               function(){ console.log("scheduler ended"); })
scheduler.on('poll',              function(){ console.log("scheduler polling"); })
scheduler.on('working_timestamp', function(timestamp){ console.log("scheduler working timestamp " + timestamp); })
scheduler.on('transfered_job',    function(timestamp, job){ console.log("scheduler enquing job " + timestamp + " >> " + JSON.stringify(job)); })

////////////////////////
// CONNECT TO A QUEUE //
////////////////////////

var queue = new AR.queue({connection: connectionDetails, queue: 'math'}, function(){
  queue.enqueue("add", [1,2]);
  queue.enqueue("add", [2,3]);
  queue.enqueueIn(3000,"subtract", [2,1]);
});
```

## Configutation Options:

`new queue` requires only the "queue" variable to be set.

`new worker` has some additonal options:

```javascript
options = {
  looping: true,
  timeout: 5000,
  queues:  "*",
  name:    os.hostname() + ":" + process.pid
}
```

The configuration hash passed to `new worker`, `new scheduler` or `new queue` can also take a `connection` option.  

```javascript
var connectionDetails = {
  host:      "127.0.0.1",
  password:  "",
  port:      6379,
  database:  0,
  namespace: "resque",
}

var worker = new AR.worker({connection: connectionDetails, queues: 'math'}, jobs, function(){
  worker.start();
});
```

## Notes
- Be sure to call `worker.end()` before shutting down your application if you want to properly clear your worker status from resque
- When ending your application, be sure to allow your workers time to finsih what they are working on
- `worker.workerCleanup()` only works for *nix operating systems (osx, unix, solaris, etc)
- If you plan to run more than one worker per nodejs process, be sure to name them something distinct.  Names **must** follow the patern `hostname:pid:unique_id`.  For example: 

```javascript
var name = os.hostname() + ":" + process.pid() + counter;
var worker = new AR.worker({connection: connectionDetails, queues: 'math', 'name' : name}, jobs);
```

## Acknowledgments
Most of this code was inspired by / stolen from [coffee-resque](https://npmjs.org/package/coffee-resque) and [coffee-resque-scheduler](https://github.com/leeadkins/coffee-resque-scheduler).  Thanks!