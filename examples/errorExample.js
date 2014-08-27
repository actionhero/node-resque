/////////////////////////
// REQUIRE THE PACKAGE //
/////////////////////////

var NR = require(__dirname + "/../index.js");
// In your projects: var NR = require("node-resque");

///////////////////////////
// SET UP THE CONNECTION //
///////////////////////////

var connectionDetails = {
  package:   "redis",
  host:      "127.0.0.1",
  password:  "",
  port:      6379,
  database:  0,
  // namespace: "resque",
  // looping: true
}

//////////////////////////////
// DEFINE YOUR WORKER TASKS //
//////////////////////////////

var jobsToComplete = 0;
var jobs = {
  "brokenJob": {
    plugins: [],
    pluginOptions: {},
    perform: function(a,b,callback){
      jobsToComplete--;
      shutdown();

      MISSING_VAR + THING;

      callback(null);
    },
  },
};

////////////////////
// START A WORKER //
////////////////////

var worker = new NR.worker({connection: connectionDetails, queues: ['default']}, jobs, function(){
  worker.workerCleanup(); // optional: cleanup any previous improperly shutdown workers
  worker.start();
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
worker.on('failure',         function(queue, job, failure){ console.log("job failure " + queue + " " + JSON.stringify(job) + " >> " + failure); })
worker.on('error',           function(queue, job, error){ console.log("error " + queue + " " + JSON.stringify(job) + " >> " + error); })
worker.on('pause',           function(){ console.log("worker paused"); })

////////////////////////
// CONNECT TO A QUEUE //
////////////////////////

var queue = new NR.queue({connection: connectionDetails}, jobs, function(){
  queue.enqueue('default', "brokenJob", {a: 1,b: 2} );
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
}
