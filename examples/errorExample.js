/////////////////////////
// REQUIRE THE PACKAGE //
/////////////////////////

var NR = require(__dirname + '/../index.js');
// In your projects: var NR = require('node-resque');

///////////////////////////
// SET UP THE CONNECTION //
///////////////////////////

var connectionDetails = {
  pkg:       'ioredis',
  host:      '127.0.0.1',
  password:  null,
  port:      6379,
  database:  0,
  // namespace: 'resque',
  // looping: true,
  // // options: {password: 'abc'},
};

//////////////////////////////
// DEFINE YOUR WORKER TASKS //
//////////////////////////////

var jobsToComplete = 0;
var jobs = {
  'brokenJob': {
    plugins: [],
    pluginOptions: {},
    perform: function(a, b, callback){
      jobsToComplete--;
      shutdown();

      // A ReferenceError like this would cause the application to crash
      // and your job would be lost.
      // If you have an unsafe job like this, consider domains maybe?
      //MISSING_VAR + THING;

      // however jobs which return an error callback properly will be
      // logged in redis accordingly
      var error = new Error('broken message from job');
      callback(error);
    },
  },
};

////////////////////
// START A WORKER //
////////////////////

var worker = new NR.worker({connection: connectionDetails, queues: ['default']}, jobs);
worker.connect(function(){
  worker.workerCleanup(); // optional: cleanup any previous improperly shutdown workers on this host
  worker.start();
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

////////////////////////
// CONNECT TO A QUEUE //
////////////////////////

var queue = new NR.queue({connection: connectionDetails}, jobs);
queue.connect(function(){
  queue.enqueue('default', 'brokenJob', [1, 2]);
  jobsToComplete = 1;
});

var shutdown = function(){
  if(jobsToComplete === 0){
    setTimeout(function(){
      worker.end(function(){
        process.exit();
      });
    }, 500);
  }
};
