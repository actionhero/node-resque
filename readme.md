# node-resque
Delayed Tasks in nodejs.  A very opinionated but compatible API with [resque](https://github.com/resque/resque) and [resque scheduler](https://github.com/resque/resque-scheduler)

[![Nodei stats](https://nodei.co/npm/node-resque.png?downloads=true)](https://npmjs.org/package/node-resque)

[![Build Status](https://secure.travis-ci.org/taskrabbit/node-resque.png?branch=master)](http://travis-ci.org/taskrabbit/node-resque)

## Usage

I learn best by examples:

```javascript
/////////////////////////
// REQUIRE THE PACKAGE //
/////////////////////////

var NR = require("node-resque");

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
  "add": {
    perform: function(a,b,callback){
      var answer = a + b;
      callback(null, answer);
    },
  },
  "subtract": {
    perform: function(a,b,callback){
      var answer = a - b;
      callback(null, answer);
    },
  },
};

////////////////////
// START A WORKER //
////////////////////

var worker = new NR.worker({connection: connectionDetails, queues: ['math']}, jobs, function(){
  worker.workerCleanup(); // optional: cleanup any previous improperly shutdown workers
  worker.start();
});

///////////////////////
// START A SCHEDULER //
///////////////////////

var scheduler = new NR.scheduler({connection: connectionDetails}, function(){
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
worker.on('reEnqueue',       function(queue, job, plugin){ console.log("reEnqueue job (" + plugin + ") " + queue + " " + JSON.stringify(job)); })
worker.on('success',         function(queue, job, result){ console.log("job success " + queue + " " + JSON.stringify(job) + " >> " + result); })
worker.on('error',           function(queue, job, error){ console.log("job failed " + queue + " " + JSON.stringify(job) + " >> " + error); })
worker.on('pause',           function(){ console.log("worker paused"); })

scheduler.on('start',             function(){ console.log("scheduler started"); })
scheduler.on('end',               function(){ console.log("scheduler ended"); })
scheduler.on('error',             function(error){ console.log("scheduler error >> " + error); })
scheduler.on('poll',              function(){ console.log("scheduler polling"); })
scheduler.on('working_timestamp', function(timestamp){ console.log("scheduler working timestamp " + timestamp); })
scheduler.on('transferred_job',    function(timestamp, job){ console.log("scheduler enquing job " + timestamp + " >> " + JSON.stringify(job)); })

////////////////////////
// CONNECT TO A QUEUE //
////////////////////////

var queue = new NR.queue({connection: connectionDetails}, jobs, function(){
  queue.enqueue('math', "add", [1,2]);
  queue.enqueue('math', "add", [2,3]);
  queue.enqueueIn(3000, 'math', "subtract", [2,1]);
});
```

## Configutation Options:

`new queue` requires only the "queue" variable to be set.  You can also pass the `jobs` hash to it.

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
  package:   "redis",
  host:      "127.0.0.1",
  password:  "",
  port:      6379,
  database:  0,
  namespace: "resque",
}

var worker = new NR.worker({connection: connectionDetails, queues: 'math'}, jobs, function(){
  worker.start();
});
```

You can also pass redis client directly.

```javascript
// assume you already initialize redis client before

var connectionDetails = { redis: redisClient }

var worker = new NR.worker({connection: connectionDetails, queues: 'math'}, jobs, function(){
  worker.start();
});
```

## Notes
- Be sure to call `worker.end()` before shutting down your application if you want to properly clear your worker status from resque
- When ending your application, be sure to allow your workers time to finsih what they are working on
- If you are using any plugins which effect `beforeEnqueue` or `afterEnqueue`, be sure to pass the `jobs` argument to the `new Queue` constructor
- If you plan to run more than one worker per nodejs process, be sure to name them something distinct.  Names **must** follow the patern `hostname:pid+unique_id`.  For example:

```javascript
var name = os.hostname() + ":" + process.pid() + "+" + counter;
var worker = new NR.worker({connection: connectionDetails, queues: 'math', 'name' : name}, jobs);
```
## Queue Managment

Additonal methods provided on the `queue` object:

- **queue.prototype.queues** = function(callback)
  - callback(error, array_of_queues)
- **queue.prototype.length** = function(q, callback)
  - callback(error, number_of_elements_in_queue)
- **queue.prototype.del** = function(q, func, args, count, callback)
  - callback(error, number_of_items_deleted)
- **queue.prototype.delDelayed** = function(q, func, args, callback)
  - callback(error, timestamps_the_job_was_removed_from)
- **queue.prototype.scheduledAt** = function(q, func, args, callback)
  - callback(error, timestamps_the_job_is_scheduled_for)

## Plugins

Just like ruby's resque, you can write worker plugins.  They look look like this.  The 4 hooks you have are `before_enqueue`, `after_enqueue`, `before_perform`, and `after_perform`

```javascript

var myPlugin = function(worker, func, queue, job, args, options){
  var self = this;
  self.name = 'myPlugin';
  self.worker = worker;
  self.queue = queue;
  self.func = func;
  self.job = job;
  self.args = args;
  self.options = options;
}

////////////////////
// PLUGIN METHODS //
////////////////////

myPlugin.prototype.before_enqueue = function(callback){
  // console.log("** before_enqueue")
  callback(null, true);
}

myPlugin.prototype.after_enqueue = function(callback){
  // console.log("** after_enqueue")
  callback(null, true);
}

myPlugin.prototype.before_perform = function(callback){
  // console.log("** before_perform")
  callback(null, true);
}

myPlugin.prototype.after_perform = function(callback){
  // console.log("** after_perform")
  callback(null, true);
}

```

And then your plugin can be invoked within a job like this:

```javascript
var jobs = {
  "add": {
    plugins: [ 'myPlugin' ],
    pluginOptions: {
      myPlugin: { thing: 'stuff' },
    },
    perform: function(a,b,callback){
      var answer = a + b;
      callback(null, answer);
    },
  },
}
```

**notes**

- All plugins which return `(error, toRun)`.  if `toRun = false` on  `beforeEnqueue`, the job beign inqueued will be thrown away, and if `toRun = false` on `beforePerfporm`, the job will be reEnqued and not run at this time.  However, it doesn't really matter what `toRun` returns on the `after` hooks.
- If you are writing a plugin to deal with errors which may occur during your resque job, you can inspect and modify `worker.error` in your plugin.  If `worker.error` is null, no error will be logged in the resque error queue.
- There are a few included plugins, all in the lib/plugins/* directory. You can rewrite you own and include it like this:

```javascript
var jobs = {
  "add": {
    plugins: [ require('myplugin') ],
    pluginOptions: {
      myPlugin: { thing: 'stuff' },
    },
    perform: function(a,b,callback){
      var answer = a + b;
      callback(null, answer);
    },
  },
}
```

## Acknowledgments
Most of this code was inspired by / stolen from [coffee-resque](https://npmjs.org/package/coffee-resque) and [coffee-resque-scheduler](https://github.com/leeadkins/coffee-resque-scheduler).  Thanks!
