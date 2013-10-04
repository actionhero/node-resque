/////////////////////////
// REQUIRE THE PACKAGE //
/////////////////////////

var AR = require(__dirname + "/index.js");
// In your projects: var AR = require("action_resque");

///////////////////////////
// SET UP THE CONNECTION //
///////////////////////////

var connectionDetails = {
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
  add: function(job,callback){
    jobsToComplete--;
    shutdown();

    var answer = job.args[0] + job.args[1]
    callback(answer);
  },
  subtract: function(job,callback){
    jobsToComplete--;
    shutdown();
    
    var answer = job.args[0] - job.args[1]; 
    callback(answer);
  }
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

var queue = new AR.queue({connection: connectionDetails}, function(){
  queue.enqueue('math', "add", [1,2]);
  queue.enqueue('math', "add", [2,3]);
  queue.enqueueIn(3000, 'math', "subtract", [2,1]);
  jobsToComplete = 3;  
});

var shutdown = function(){
  if(jobsToComplete === 0){
    setTimeout(function(){
      scheduler.end(function(){
        worker.end(function(){
          process.exit();
        });
      });
    }, 500);
  }
}