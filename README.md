# node-resque: The best background jobs in node.

**Distributed delayed jobs in nodejs**.  Resque is a background job system backed by [Redis](http://redis.io) (version 2.0.0 and up required).  It includes priority queues, plugins, locking, delayed jobs, and more!  This project is a very opinionated but API-compatible with [Resque](https://github.com/resque/resque) and [Sidekiq](http://sidekiq.org/).  We also implement some of the popular Resque plugins, including [resque-scheduler](https://github.com/resque/resque-scheduler) and [resque-retry](https://github.com/lantins/resque-retry)

[![Nodei stats](https://nodei.co/npm/node-resque.png?downloads=true)](https://npmjs.org/package/node-resque)

[![Build Status](https://secure.travis-ci.org/taskrabbit/node-resque.png?branch=master)](http://travis-ci.org/taskrabbit/node-resque)

## Version Notes
* ‼️ Version 5+ of Node Resque uses async/await.  There is no upgrade path from previous versions.  Node v8.0.0+ is required.

## Usage

I learn best by examples:

```javascript
const path = require('path')
const NodeResque = require(path.join(__dirname, '..', 'index.js'))
// In your projects: const NR = require('node-resque');

async function boot () {
  // ////////////////////////
  // SET UP THE CONNECTION //
  // ////////////////////////

  const connectionDetails = {
    pkg: 'ioredis',
    host: '127.0.0.1',
    password: null,
    port: 6379,
    database: 0
    // namespace: 'resque',
    // looping: true,
    // options: {password: 'abc'},
  }

  // ///////////////////////////
  // DEFINE YOUR WORKER TASKS //
  // ///////////////////////////

  let jobsToComplete = 0

  const jobs = {
    'add': {
      plugins: ['JobLock'],
      pluginOptions: {
        JobLock: {}
      },
      perform: async (a, b) => {
        let answer = a + b
        await new Promise((resolve) => { setTimeout(resolve, 1000) })
        return answer
      }
    },
    'subtract': {
      perform: (a, b) => {
        let answer = a - b
        return answer
      }
    }
  }

  // /////////////////
  // START A WORKER //
  // /////////////////

  const worker = new NodeResque.Worker({connection: connectionDetails, queues: ['math', 'otherQueue']}, jobs)
  await worker.connect()
  await worker.workerCleanup() // optional: cleanup any previous improperly shutdown workers on this host
  worker.start()

  // ////////////////////
  // START A SCHEDULER //
  // ////////////////////

  const scheduler = new NodeResque.Scheduler({connection: connectionDetails})
  await scheduler.connect()
  scheduler.start()

  // //////////////////////
  // REGESTER FOR EVENTS //
  // //////////////////////

  worker.on('start', () => { console.log('worker started') })
  worker.on('end', () => { console.log('worker ended') })
  worker.on('cleaning_worker', (worker, pid) => { console.log(`cleaning old worker ${worker}`) })
  worker.on('poll', (queue) => { console.log(`worker polling ${queue}`) })
  worker.on('job', (queue, job) => { console.log(`working job ${queue} ${JSON.stringify(job)}`) })
  worker.on('reEnqueue', (queue, job, plugin) => { console.log(`reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`) })
  worker.on('success', (queue, job, result) => { console.log(`job success ${queue} ${JSON.stringify(job)} >> ${result}`) })
  worker.on('failure', (queue, job, failure) => { console.log(`job failure ${queue} ${JSON.stringify(job)} >> ${failure}`) })
  worker.on('error', (error, queue, job) => { console.log(`error ${queue} ${JSON.stringify(job)}  >> ${error}`) })
  worker.on('pause', () => { console.log('worker paused') })

  scheduler.on('start', () => { console.log('scheduler started') })
  scheduler.on('end', () => { console.log('scheduler ended') })
  scheduler.on('poll', () => { console.log('scheduler polling') })
  scheduler.on('master', (state) => { console.log('scheduler became master') })
  scheduler.on('error', (error) => { console.log(`scheduler error >> ${error}`) })
  scheduler.on('workingTimestamp', (timestamp) => { console.log(`scheduler working timestamp ${timestamp}`) })
  scheduler.on('transferredJob', (timestamp, job) => { console.log(`scheduler enquing job ${timestamp} >> ${JSON.stringify(job)}`) })

  // //////////////////////
  // CONNECT TO A QUEUE //
  // //////////////////////

  const queue = new NodeResque.Queue({connection: connectionDetails}, jobs)
  queue.on('error', function (error) { console.log(error) })
  await queue.connect()
  await queue.enqueue('math', 'add', [1, 2])
  await queue.enqueue('math', 'add', [1, 2])
  await queue.enqueue('math', 'add', [2, 3])
  await queue.enqueueIn(3000, 'math', 'subtract', [2, 1])
}

boot()

```

## Configuration Options:

`new queue` requires only the "queue" variable to be set.  You can also pass the `jobs` hash to it.

`new worker` has some additional options:

```javascript
options = {
  looping: true,
  timeout: 5000,
  queues:  "*",
  name:    os.hostname() + ":" + process.pid
}
```

The configuration hash passed to `new NodeResque.Worker`, `new NodeResque.Scheduler` or `new NodeResque.Queue` can also take a `connection` option.

```javascript
var connectionDetails = {
  pkg:       "ioredis",
  host:      "127.0.0.1",
  password:  "",
  port:      6379,
  database:  0,
  namespace: "resque",
}

var worker = new NodeResque.Worker({connection: connectionDetails, queues: 'math'}, jobs);

worker.on('error', (error) => {
	// handler errors
});

await worker.connect()
worker.start()
```

You can also pass redis client directly.

```javascript
// assume you already initialize redis client before

var redisClient = new Redis()
var connectionDetails = { redis: redisClient }

var worker = new NodeResque.Worker({connection: connectionDetails, queues: 'math'}, jobs);

worker.on('error', (error) => {
	// handler errors
});

await worker.connect()
worker.start()
```

## Notes
- Be sure to call `await worker.end()`, `await queue.end()` and `await scheduler.end()` before shutting down your application if you want to properly clear your worker status from resque.
- When ending your application, be sure to allow your workers time to finish what they are working on
- This project implements the "scheduler" part of rescue-scheduler (the daemon which can promote enqueued delayed jobs into the work queues when it is time), but not the CRON scheduler proxy.  To learn more about how to use a CRON-like scheduler, read the [Job Schedules](#job-schedules) section of this document.
- If you are using any plugins which effect `beforeEnqueue` or `afterEnqueue`, be sure to pass the `jobs` argument to the `new NodeResque.Queue()` constructor
- If a job fails, it will be added to a special `failed` queue.  You can then inspect these jobs, write a plugin to manage them, move them back to the normal queues, etc.  Failure behavior by default is just to enter the `failed` queue, but there are many options.  Check out these examples from the ruby ecosystem for inspiration:
  - https://github.com/lantins/resque-retry
  - https://github.com/resque/resque/wiki/Failure-Backends
- If you plan to run more than one worker per nodejs process, be sure to name them something distinct.  Names **must** follow the pattern `hostname:pid+unique_id`.  For example:

```javascript
var name = os.hostname() + ":" + process.pid + "+" + counter;
var worker = new NodeResque.Worker({connection: connectionDetails, queues: 'math', 'name' : name}, jobs);
```

###  Worker#performInline

**DO NOT USE THIS IN PRODUCTION**. In tests or special cases, you may want to process/work a job in-line. To do so, you can use `worker.performInline(jobName, arguments, callback)`.  If you are planning on running a job via #performInline, this worker should also not be started, nor should be using event emitters to monitor this worker.  This method will also not write to redis at all, including logging errors, modify resque's stats, etc.

## Queue Management

```js
const queue = new NodeResque.Queue({connection: connectionDetails, jobs})
await queue.connect()
```

Additional methods provided on the `queue` object:

**`let stats = await queue.stats()`**
  - stats will be a hash containing details about all the queues in your redis, and how many jobs are in each

**`let queues = await queue.queues()`**
  - queues is an Array with the names of all your queues

**`let didDelete = await queue.delQueue()`**
  - delete a queue, and all jobs in that queue.
  - didDelete is a boolean indicating if the queue was deleted (false would indicate the queue didn't exist to delete)

**`let jobs = await queue.queued(q, start, stop)`**
  - list all the jobs (with their payloads) in a queue between start index and stop index.
  - jobs is an array containing the payload of the job enqueued

**`let length = await queue.length(q)`**
  - length is an integer counting the length of the jobs in the queue
  - this does not include delayed jobs for this queue

**`let locks = await queue.locks()`**
  - types of locks include queue and worker locks, as created by the plugins below
  - `locks` is a hash by type and timestamp

**`let count = await queue.delLock(lockName)`**
  - `count` is an integer.  You might delete more than one lock by the name.

**`let numberOfJobsDeleted = await queue.del(q, func, args, count)`**
  - jobs are deleted by those matching a `func` and agument collection within a given queue.
  - You might match none, or you might match many.

**`let timestamps = await queue.delDelayed(q, func, args)`**
  - same as the above, but for delayed jobs at any timestamp(s)
  - You might match none, or you might match many.  `timestamps` is an array of integers.

**`let timestampsForJob = await queue.scheduledAt(q, func, args)`**
  - learn the timestamps at which a job is scheduled to be run.
  - `timestampsForJob` is an array of integers

**await queue.end()**

## Delayed Status

**`let timestamps = await queue.timestamps()`**
  - `timestamps` is an array of integers for all timestamps which have at least one job scheduled in the future

**`let jobsEnqueuedForThisTimestamp = await queue.delayedAt(timestamp)`**
  - `jobsEnqueuedForThisTimestamp` is an array, matching the style of the response of `queue.queued`

**`let jobs = queue.allDelayed()`**
  - jobsHash is an object with its keys being timestamps, and the vales are arrays of jobs at each time.
  - note that this operation can be very slow and very ram-heavy

## Worker Status

You can use the queue object to check on your workers:

**`let workers = await queue.workers()`**
  - returns a hash of the form: `{ 'host:pid': 'queue1, queue2', 'host:pid': 'queue1, queue2' }`

**`let workerStatus = await queue.workingOn(workerName, queues)`**
  - returns: `{"run_at":"Fri Dec 12 2014 14:01:16 GMT-0800 (PST)","queue":"test_queue","payload":{"class":"slowJob","queue":"test_queue","args":[null]},"worker":"workerA"}`

**`let details = await queue.allWorkingOn()`**
  - returns a hash of the results of `queue.workingOn` with the worker names as keys.

## Failed Job Management

From time to time, your jobs/workers may fail.  Resque workers will move failed jobs to a special `failed` queue which will store the original arguments of your job, the failing stack trace, and additional metadata.

![error example](https://raw.githubusercontent.com/taskrabbit/node-resque/master/images/error_payload.png)

You can work with these failed jobs with the following methods:

**`let failedCount = await queue.failedCount()`**
  - `failedCount` is the number of jobs in the failed queue

**`let failedJobs = await queue.failed(start, stop)`**
  - `failedJobs` is an array listing the data of the failed jobs.  Each element looks like:

### Failing a Job

We use a try/catch pattern to catch errors in your jobs. If any job throws an uncaught exception, it will be caught, and the job's payload moved to the error queue for inspection. Do not use `domains`, `process.onExit`, or any other method of "catching" a process crash.  The error paylaod looks like:

```javascript
{ worker: 'busted-worker-3',
  queue: 'busted-queue',
  payload: { class: 'busted_job', queue: 'busted-queue', args: [ 1, 2, 3 ] },
  exception: 'ERROR_NAME',
  error: 'I broke',
  failed_at: 'Sun Apr 26 2015 14:00:44 GMT+0100 (BST)' }
```

**`await queue.removeFailed(failedJob)`**
  - the input `failedJob` is an expanded node object representing the failed job, retrieved via `queue.failed`

**`await queue.retryAndRemoveFailed(failedJob)`**
  - the input `failedJob` is an expanded node object representing the failed job, retrieved via `queue.failed`
  - this method will instantly re-enqueue a failed job back to its original queue, and delete the failed entry for that job

## Failed Worker Management

Sometimes a worker crashes is a *severe* way, and it doesn't get the time/chance to notify redis that it is leaving the pool (this happens all the time on PAAS providers like Heroku).  When this happens, you will not only need to extract the job from the now-zombie worker's "working on" status, but also remove the stuck worker.  To aid you in these edge cases, `await queue.cleanOldWorkers(age)` is available.  

Because there are no 'heartbeats' in resque, it is imposable for the application to know if a worker has been working on a long job or it is dead.  You are required to provide an "age" for how long a worker has been "working", and all those older than that age will be removed, and the job they are working on moved to the error queue (where you can then use `queue.retryAndRemoveFailed`) to re-enqueue the job.

If you know the name of a worker that should be removed, you can also call `await queue.forceCleanWorker(workerName)` directly, and that will also remove the worker and move any job it was working on into the error queue.

## Job Schedules

You may want to use node-resque to schedule jobs every minute/hour/day, like a distributed CRON system.  There are a number of excellent node packages to help you with this, like [node-schedule](https://github.com/tejasmanohar/node-schedule) and [node-cron](https://github.com/ncb000gt/node-cron).  Node-resque makes it possible for you to use the package of your choice to schedule jobs with.  

Assuming you are running node-resque across multiple machines, you will need to ensure that only one of your processes is actually scheduling the jobs.  To help you with this, you can inspect which of the scheduler processes is currently acting as master, and flag only the master scheduler process to run the schedule.  A full example can be found at [/examples/scheduledJobs.js](https://github.com/taskrabbit/node-resque/blob/master/examples/scheduledJobs.js), but the relevant section is:

``` javascript
const NodeResque = require('node-resque')
const schedule = require('node-schedule')
const queue = new NodeResque.Queue({connection: connectionDetails}, jobs)
const scheduler = new NodeResque.Scheduler({connection: connectionDetails});
await scheduler.connect()
scheduler.start()


schedule.scheduleJob('10,20,30,40,50 * * * * *', async () => { // do this job every 10 seconds, CRON style
  // we want to ensure that only one instance of this job is scheduled in our environment at once,
  // no matter how many schedulers we have running
  if(scheduler.master){
    console.log(">>> enquing a job");
    await queue.enqueue('time', "ticktock", new Date().toString() );
  }
});
```

## Plugins

Just like ruby's resque, you can write worker plugins.  They look look like this.  The 4 hooks you have are `beforeEnqueue`, `afterEnqueue`, `beforePerform`, and `afterPerform`.  Plugins are `classes` which extend `NodeResque.Plugin`

```javascript
const NodeResque = require('node-resque')

class MyPlugin extends NodeResque.Plugin {
  beforeEnqueue () {
    // console.log("** beforeEnqueue")
    return true // should the job be enqueued?
  }

  afterEnqueue () {
    // console.log("** afterEnqueue")
  }

  beforePerform () {
    // console.log("** beforePerform")
    return true // should the job be run?
  }

  afterPerform () {
    // console.log("** afterPerform")
  }
}

```

And then your plugin can be invoked within a job like this:

```javascript
const jobs = {
  "add": {
    plugins: [ 'MyPlugin' ],
    pluginOptions: {
      MyPlugin: { thing: 'stuff' },
    },
    perform: (a,b) => {
      let answer = a + b
      return answer
    },
  },
}
```

**notes**

- You need to return `true` or `false` on the before hooks.  `true` indicates that the action should continue, and `false` prevents it.  This is called `toRun`.
- If you are writing a plugin to deal with errors which may occur during your resque job, you can inspect and modify `this.worker.error` in your plugin.  If `this.worker.error` is null, no error will be logged in the resque error queue.
- There are a few included plugins, all in the lib/plugins/* directory. You can rewrite you own and include it like this:

```javascript
var jobs = {
  "add": {
    plugins: [ require('Myplugin') ],
    pluginOptions: {
      MyPlugin: { thing: 'stuff' },
    },
    perform: (a,b) => {
      let answer = a + b;
      return answer
    },
  },
}
```

The plugins which are included with this package are:
- `DelayQueueLock`
  - If a job with the same name, queue, and args is already in the delayed queue(s), do not enqueue it again
- `JobLock`
  - If a job with the same name, queue, and args is already running, put this job back in the queue and try later
- `QueueLock`
  - If a job with the same name, queue, and args is already in the queue, do not enqueue it again
- `Retry`
  - If a job fails, retry it N times before finally placing it into the failed queue

## Multi Worker

`node-resque` provides a wrapper around the `Worker` class which will auto-scale the number of resque workers.  This will process more than one job at a time as long as there is idle CPU within the event loop.  For example, if you have a slow job that sends email via SMTP (with low  overhead), we can process many jobs at a time, but if you have a math-heavy operation, we'll stick to 1.  The `MultiWorker` handles this by spawning more and more node-resque workers and managing the pool.  

```javascript
var NodeResque = require(__dirname + "/../index.js");

var connectionDetails = {
  pkg:       "ioredis",
  host:      "127.0.0.1",
  password:  ""
}

var multiWorker = new NodeResque.MultiWorker({
  connection: connectionDetails,
  queues: ['slowQueue'],
  minTaskProcessors:   1,
  maxTaskProcessors:   100,
  checkTimeout:        1000,
  maxEventLoopDelay:   10,  
  toDisconnectProcessors: true,
}, jobs);

// normal worker emitters
multiWorker.on('start',             (workerId) => {                      console.log("worker["+workerId+"] started"); })
multiWorker.on('end',               (workerId) => {                      console.log("worker["+workerId+"] ended"); })
multiWorker.on('cleaning_worker',   (workerId, worker, pid) => {         console.log("cleaning old worker " + worker); })
multiWorker.on('poll',              (workerId, queue) => {               console.log("worker["+workerId+"] polling " + queue); })
multiWorker.on('job',               (workerId, queue, job) => {          console.log("worker["+workerId+"] working job " + queue + " " + JSON.stringify(job)); })
multiWorker.on('reEnqueue',         (workerId, queue, job, plugin) => {  console.log("worker["+workerId+"] reEnqueue job (" + plugin + ") " + queue + " " + JSON.stringify(job)); })
multiWorker.on('success',           (workerId, queue, job, result) => {  console.log("worker["+workerId+"] job success " + queue + " " + JSON.stringify(job) + " >> " + result); })
multiWorker.on('failure',           (workerId, queue, job, failure) => { console.log("worker["+workerId+"] job failure " + queue + " " + JSON.stringify(job) + " >> " + failure); })
multiWorker.on('error',             (workerId, queue, job, error) => {   console.log("worker["+workerId+"] error " + queue + " " + JSON.stringify(job) + " >> " + error); })
multiWorker.on('pause',             (workerId) => {                      console.log("worker["+workerId+"] paused"); })

// multiWorker emitters
multiWorker.on('internalError',     (error) => {                         console.log(error); })
multiWorker.on('multiWorkerAction', (verb, delay) => {                   console.log("*** checked for worker status: " + verb + " (event loop delay: " + delay + "ms)"); });

multiWorker.start();
```

### MultiWorker Options

The Options available for the multiWorker are:
- `connection`: The redis configuration options (same as worker)
- `queues`: Array of ordered queue names (or `*`) (same as worker)
- `minTaskProcessors`: The minimum number of workers to spawn under this multiWorker, even if there is no work to do.  You need at least one, or no work will ever be processed or checked
- `maxTaskProcessors`: The maximum number of workers to spawn under this multiWorker, even if the queues are long and there is available CPU (the event loop isn't entirely blocked) to this node process.
- `checkTimeout`: How often to check if the event loop is blocked (in ms) (for adding or removing multiWorker children),
- `maxEventLoopDelay`: How long the event loop has to be delayed before considering it blocked (in ms),  
- `toDisconnectProcessors`: If false, all multiWorker children will share a single redis connection.  If true, each child will connect and disconnect separately.  This will lead to more redis connections, but faster retrieval of events.

## Presentation
This package was featured heavily in [this presentation I gave](https://blog.evantahler.com/background-tasks-in-node-js-a-survey-with-redis-971d3575d9d2#.rzph5ofgy) about background jobs + node.js.  It contains more examples!

## Acknowledgments
- Most of this code was inspired by / stolen from [coffee-resque](https://npmjs.org/package/coffee-resque) and [coffee-resque-scheduler](https://github.com/leeadkins/coffee-resque-scheduler).  Thanks!
- This Resque package aims to be fully compatible with [Ruby's Resque](https://github.com/resque/resque) and implamentations of [Resque Scheduler](https://github.com/resque/resque-scheduler).  Other packages from other langauges may conflict.
- If you are looking for a UI to manage your Resque instances in nodejs, check out [ActionHero's Resque UI](https://github.com/evantahler/ah-resque-ui)
