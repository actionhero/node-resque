var AR = require(__dirname + "/index.js");
// In your projects: var AR = require("action_resque");
var connectionDetails = {
  host:      "127.0.0.1",
  password:  "",
  port:      6379,
  database:  0,
  // namespace: "resque",
  // looping: true
}

var jobsToComplete = 0;

var jobs = {
  add: function(a,b,callback){
    console.log("adding " + a + " + " + b);
    jobsToComplete--;
    if(jobsToComplete == 0){ shutdown(); }
    callback(a + b);
  },
  subtract: function(a,b,callback){
    console.log("subtracting " + a + " - " + b);
    jobsToComplete--;
    if(jobsToComplete == 0){ shutdown(); }
    callback(a - b);
  },
};

var worker = new AR.worker({connection: connectionDetails, queues: 'math'}, jobs, function(){
  worker.start();
});

var queue = new AR.queue({connection: connectionDetails, queue: 'math'}, function(){
  queue.enqueue("add", [1,2]);
  queue.enqueue("subtract", [2,1]);
  jobsToComplete = 2;  
});

var shutdown = function(){
  setTimeout(function(){
    worker.end(function(){
      process.exit();
    });
  }, 500);
}