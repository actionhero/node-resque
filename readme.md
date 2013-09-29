# actionQueue
Delayed Tasks in nodejs.  A very opinionated but compatible API with [resque](https://github.com/resque/resque) and [resque scheduler](https://github.com/resque/resque-scheduler)

## Usage

```javascript
// require the package
var AR = require("action_resque");

// define some jobs
var jobs = {
  add: function(a,b,callback){
    console.log("adding " + a + "+" + b + ": " + (a + b));
    callback();
  },
  subtract: function(a,b,callback){
    console.log("subtractinh " + a + "-" + b + ": " + (a - b));
    callback();
  },
};

// start a the worker
var worker = new AR.worker({queues: 'math'}, jobs, function(){
  worker.start();
});

// enqueue some jobs
var queue = new AR.queue({queue: 'math'}, function(){
  queue.enqueue("add", [1,2]);
  queue.enqueue("subtract", [2,1]);
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

The configuration hash passed to `new worker` or `new queue` can also take a `connection` option.  

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
``

## Acknowledgments
Most of this code was inspired by / stolen from [coffee-resque](https://npmjs.org/package/coffee-resque) and [coffee-resque-scheduler](https://github.com/leeadkins/coffee-resque-scheduler).  Thanks!

##TODO:
- domains for running jobs
- domains for everything else (if redis dies)
- graceful shutdown
- locking for scheduler?  Do we need this?
- tests