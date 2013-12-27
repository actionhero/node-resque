/////////////////////////
// REQUIRE THE PACKAGE //
/////////////////////////

var NR = require(__dirname + "/index.js");
// In your projects: var NR = require("node-resque");

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
var jobsToComplete = 2;

var jobs = {
  "remoteEventAdd": {
    perform: function(payload, callback){
      var answer = payload.a + payload.b; 
      callback(answer);

      jobsToComplete--;
      shutdown();
    },
  },
  "remoteEventSubtract": {
    perform: function(payload, callback){
      var answer = payload.a + payload.b; 
      callback(answer);

      jobsToComplete--;
      shutdown();
    },
  },
};

///////////////////////
// START A SCHEDULER //
///////////////////////

var scheduler = new NR.scheduler({connection: connectionDetails}, function(){
  scheduler.start();
});


///////////////
// SUBSCRIBE //
///////////////

var worker;
var queues;
var bus = new NR.bus({connection: connectionDetails}, function(){

  bus.subscribe('subscribeExample', 'remoteJobs',      'remoteEventAdd', { method : "^.*add.*" }      , function(err, q){
  bus.subscribe('subscribeExample', 'remoteJobs', 'remoteEventSubtract', { method : "^.*subtract.*" } , function(err, q){
    var combined_queue_name = q;
    console.log("subscribed to " + combined_queue_name);

    ///////////////////////////////
    // APPEND THE DRIVER TO JOBS //
    ///////////////////////////////

    jobs[bus.options.busDriverClassKey] = bus.driverJob();

    ////////////////////
    // START A WORKER //
    ////////////////////

    worker = new NR.worker({connection: connectionDetails, queues: [combined_queue_name, bus.options.incommigQueue]}, jobs, function(){
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
    worker.on('error',           function(queue, job, error){ console.log("job failed " + queue + " " + JSON.stringify(job) + " >> " + error); })
    worker.on('pause',           function(){ console.log("worker paused"); })

    scheduler.on('start',             function(){ console.log("scheduler started"); })
    scheduler.on('end',               function(){ console.log("scheduler ended"); })
    scheduler.on('poll',              function(){ console.log("scheduler polling"); })
    scheduler.on('working_timestamp', function(timestamp){ console.log("scheduler working timestamp " + timestamp); })
    scheduler.on('transferred_job',   function(timestamp, job){ console.log("scheduler enquing job " + timestamp + " >> " + JSON.stringify(job)); })

    ///////////////////
    // PUBLISH EVENT //
    ///////////////////

    bus.publish({
      a: 1,
      b: 2,
      method: 'add',
    });
    bus.publishAt(1000, {
      a: 2,
      b: 1,
      method: 'subtract',
    });

  });
  });
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