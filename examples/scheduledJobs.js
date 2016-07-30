/////////////////////////
// REQUIRE THE PACKAGE //
/////////////////////////

var NR = require(__dirname + '/../index.js');
// In your projects: var NR = require('node-resque');

// we'll use https://github.com/tejasmanohar/node-schedule for this example,
// but there are many other excelent node scheduling projects
var schedule = require('node-schedule');

///////////////////////////
// SET UP THE CONNECTION //
///////////////////////////

var connectionDetails = {
  pkg:   'ioredis',
  host:      '127.0.0.1',
  password:  null,
  port:      6379,
  database:  0,
  // namespace: 'resque',
  // looping: true,
  // options: {password: 'abc'},
};

//////////////////////////////
// DEFINE YOUR WORKER TASKS //
//////////////////////////////

var jobs = {
  ticktock: function(time, callback){
    console.log('*** THE TIME IS ' + time + ' ***');
    callback(null, true);
  },
};

////////////////////
// START A WORKER //
////////////////////

var worker = new NR.worker({connection: connectionDetails, queues: ['time']}, jobs);
worker.connect(function(){
  worker.workerCleanup(); // optional: cleanup any previous improperly shutdown workers on this host
  worker.start();
});

///////////////////////
// START A SCHEDULER //
///////////////////////

var scheduler = new NR.scheduler({connection: connectionDetails});
scheduler.connect(function(){
  scheduler.start();
});

/////////////////////////
// REGESTER FOR EVENTS //
/////////////////////////

worker.on('start',           function(){ console.log('worker started'); });
worker.on('end',             function(){ console.log('worker ended'); });
worker.on('cleaning_worker', function(worker, pid){ console.log('cleaning old worker ' + worker); });
worker.on('poll',            function(queue){ console.log('worker polling ' + queue); });
worker.on('job',             function(queue, job){ console.log('working job ' + queue + ' ' + JSON.stringify(job)); });
worker.on('reEnqueue',       function(queue, job, plugin){ console.log('reEnqueue job (' + plugin + ') ' + queue + ' ' + JSON.stringify(job)); });
worker.on('success',         function(queue, job, result){ console.log('job success ' + queue + ' ' + JSON.stringify(job) + ' >> ' + result); });
worker.on('failure',         function(queue, job, failure){ console.log('job failure ' + queue + ' ' + JSON.stringify(job) + ' >> ' + failure); });
worker.on('error',           function(queue, job, error){ console.log('error ' + queue + ' ' + JSON.stringify(job) + ' >> ' + error); });
worker.on('pause',           function(){ console.log('worker paused'); });

scheduler.on('start',             function(){ console.log('scheduler started'); });
scheduler.on('end',               function(){ console.log('scheduler ended'); });
scheduler.on('poll',              function(){ console.log('scheduler polling'); });
scheduler.on('master',            function(state){ console.log('scheduler became master'); });
scheduler.on('error',             function(error){ console.log('scheduler error >> ' + error); });
scheduler.on('working_timestamp', function(timestamp){ console.log('scheduler working timestamp ' + timestamp); });
scheduler.on('transferred_job',   function(timestamp, job){ console.log('scheduler enquing job ' + timestamp + ' >> ' + JSON.stringify(job)); });


/////////////////
// DEFINE JOBS //
/////////////////

var queue = new NR.queue({connection: connectionDetails}, jobs);
queue.on('error', function(error){ console.log(error); });
queue.connect(function(){
  schedule.scheduleJob('0,10,20,30,40,50 * * * * *', function(){ // do this job every 10 seconds, cron style
    // we want to ensure that only one instance of this job is scheduled in our enviornment at once,
    // no matter how many schedulers we have running
    if(scheduler.master){
      console.log('>>> enquing a job');
      queue.enqueue('time', 'ticktock', new Date().toString());
    }
  });
});

//////////////////////
// SHUTDOWN HELPERS //
//////////////////////

var shutdown = function(){
  scheduler.end(function(){
    worker.end(function(){
      console.log('bye.');
      process.exit();
    });
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
