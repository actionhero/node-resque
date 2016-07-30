// I am an example of running multiple node-resque workers in a single process, auto-scaling with CPU utilization

var NR = require(__dirname + '/../index.js');

var connectionDetails = {
  pkg:       'ioredis',
  host:      '127.0.0.1',
  password:  null,
  port:      6379,
  database:  0,
  // namespace: 'resque',
  // looping: true,
  // options: {password: 'abc'},
};

// OR

// var ioredis = require('ioredis');
// connectionDetails = { redis: new ioredis() };

/////////////////
// DEFINE JOBS //
/////////////////

var blockingSleep = function(naptime){
  var sleeping = true;
  var now = new Date();
  var alarm;
  var startingMSeconds = now.getTime();
  while(sleeping){
    alarm = new Date();
    var alarmMSeconds = alarm.getTime();
    if(alarmMSeconds - startingMSeconds > naptime){ sleeping = false; }
  }
};

var jobs = {
  'slowSleepJob': {
    plugins: [],
    pluginOptions: {},
    perform: function(callback){
      var start = new Date().getTime();
      setTimeout(function(){
        callback(null, (new Date().getTime() - start));
      }, 1000);
    },
  },
  'slowCPUJob': {
    plugins: [],
    pluginOptions: {},
    perform: function(callback){
      var start = new Date().getTime();
      blockingSleep(1000);
      callback(null, (new Date().getTime() - start));
    },
  },
};

///////////////////
// ENQUEUE TASKS //
///////////////////

var queue = new NR.queue({connection: connectionDetails}, jobs);
queue.connect(function(){
  var i;
  i = 0;
  while(i < 10){
    queue.enqueue('slowQueue', 'slowCPUJob', []);
    i++;
  }

  i = 0;
  while(i < 100){
    queue.enqueue('slowQueue', 'slowSleepJob', []);
    i++;
  }
});

//////////
// WORK //
//////////


var multiWorker = new NR.multiWorker({
  connection: connectionDetails,
  queues: ['slowQueue'],
}, jobs);

// normal worker emitters
multiWorker.on('start',             function(workerId){                      console.log('worker[' + workerId + '] started'); });
multiWorker.on('end',               function(workerId){                      console.log('worker[' + workerId + '] ended'); });
multiWorker.on('cleaning_worker',   function(workerId, worker, pid){         console.log('cleaning old worker ' + worker); });
multiWorker.on('poll',              function(workerId, queue){               console.log('worker[' + workerId + '] polling ' + queue); });
multiWorker.on('job',               function(workerId, queue, job){          console.log('worker[' + workerId + '] working job ' + queue + ' ' + JSON.stringify(job)); });
multiWorker.on('reEnqueue',         function(workerId, queue, job, plugin){  console.log('worker[' + workerId + '] reEnqueue job (' + plugin + ') ' + queue + ' ' + JSON.stringify(job)); });
multiWorker.on('success',           function(workerId, queue, job, result){  console.log('worker[' + workerId + '] job success ' + queue + ' ' + JSON.stringify(job) + ' >> ' + result); });
multiWorker.on('failure',           function(workerId, queue, job, failure){ console.log('worker[' + workerId + '] job failure ' + queue + ' ' + JSON.stringify(job) + ' >> ' + failure); });
multiWorker.on('error',             function(workerId, queue, job, error){   console.log('worker[' + workerId + '] error ' + queue + ' ' + JSON.stringify(job) + ' >> ' + error); });
multiWorker.on('pause',             function(workerId){                      console.log('worker[' + workerId + '] paused'); });

// multiWorker emitters
multiWorker.on('internalError',     function(error){                         console.log(error); });
multiWorker.on('multiWorkerAction', function(verb, delay){                   console.log('*** checked for worker status: ' + verb + ' (event loop delay: ' + delay + 'ms)'); });

multiWorker.start();


process.on('SIGINT', function(){
  multiWorker.stop(function(){
    console.log('*** ALL STOPPED ***');
    process.exit();
  });
});
