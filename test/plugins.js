 describe('plugins', function(){

  var specHelper = require(__dirname + "/_specHelper.js").specHelper;
  var should = require('should');
  var jobDelay = 100;

  var jobs = {
    "slowAdd": {
      plugins: [ 'jobLock' ],
      pluginOptions: { jobLock: {}, },
      perform: function(a,b,callback){
        var answer = a + b; 
        setTimeout(function(){
          callback(answer);
        }, jobDelay)
      },
    },
    "uniqueJob": {
      plugins: [ 'queueLock', 'delayQueueLock' ],
      pluginOptions: { queueLock: {}, delayQueueLock: {} },
      perform: function(a,b,callback){
        var answer = a + b; 
        callback(answer);
      },
    } 
  };

  before(function(done){
    specHelper.connect(function(){
      specHelper.cleanup(function(){
        queue = new specHelper.NR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue}, jobs, function(){
          done();
        });
      });
    });
  });

  after(function(done){
    specHelper.cleanup(function(){
      done();
    });
  });

  describe('jobLock',function(){
    it('will not run 2 jobs with the same args at the same time', function(done){
      worker1 = new specHelper.NR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue}, jobs, function(){
        worker2 = new specHelper.NR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue}, jobs, function(){
          var startTime = new Date().getTime();
          var completed = 0;

          var onComplete = function(q, job, result){
            completed++;
            if(completed == 2){
              worker1.end();
              worker2.end();
              (new Date().getTime() - startTime).should.be.above(jobDelay * 2);
              done()
            }
          };

          worker1.on('success', onComplete);
          worker2.on('success', onComplete);
          queue.enqueue(specHelper.queue, "slowAdd", [1,2], function(){
            queue.enqueue(specHelper.queue, "slowAdd", [1,2], function(){
              worker1.start();
              worker2.start();
            });
          });

          worker1.on('error', function(queue, job, error){ console.log(error.stack); })
          worker2.on('error', function(queue, job, error){ console.log(error.stack); })
        });
      });
    });

    it('will run 2 jobs with the different args at the same time', function(done){
      worker1 = new specHelper.NR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue}, jobs, function(){
        worker2 = new specHelper.NR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue}, jobs, function(){
          var startTime = new Date().getTime();
          var completed = 0;

          var onComplete = function(q, job, result){
            completed++;
            if(completed == 2){
              worker1.end();
              worker2.end();
              (new Date().getTime() - startTime).should.be.below(jobDelay * 2);
              done()
            }
          };

          worker1.on('success', onComplete);
          worker2.on('success', onComplete);
          queue.enqueue(specHelper.queue, "slowAdd", [1,2], function(){
            queue.enqueue(specHelper.queue, "slowAdd", [3,4], function(){
              worker1.start();
              worker2.start();
            });
          });

          worker1.on('error', function(queue, job, error){ console.log(error.stack); })
          worker2.on('error', function(queue, job, error){ console.log(error.stack); })
        });
      });
    });
  });

  describe('queueLock',function(){

    beforeEach(function(done){
      specHelper.cleanup(function(){
        done();
      });
    });

    it('will not enque a job with the same args if it is already in the queue', function(done){
      queue.enqueue(specHelper.queue, "uniqueJob", [1,2], function(){
        queue.enqueue(specHelper.queue, "uniqueJob", [1,2], function(){
          queue.length(specHelper.queue, function(err, len){
            len.should.equal(1);
            done();
          }); 
        });
      });
    });

    it('will enque a job with the different args', function(done){
      queue.enqueue(specHelper.queue, "uniqueJob", [1,2], function(){
        queue.enqueue(specHelper.queue, "uniqueJob", [3,4], function(){
          queue.length(specHelper.queue, function(err, len){
            len.should.equal(2);
            done();
          }); 
        });
      });
    });
  });

  describe('delayQueueLock',function(){

    beforeEach(function(done){
      specHelper.cleanup(function(){
        done();
      });
    });

    it('will not enque a job with the same args if it is already in the delayed queue', function(done){
      queue.enqueueIn((10 * 1000) ,specHelper.queue, "uniqueJob", [1,2], function(){
        queue.enqueue(specHelper.queue, "uniqueJob", [1,2], function(){
          specHelper.redis.zcount(specHelper.namespace + ":delayed_queue_schedule", '-inf', '+inf', function(err, delayedLen){
            queue.length(specHelper.queue, function(err, queueLen){
              delayedLen.should.equal(1);
              queueLen.should.equal(0);
              done();
            });
          });
        });
      });
    });

    it('will enque a job with the different args', function(done){
      queue.enqueueIn((10 * 1000) ,specHelper.queue, "uniqueJob", [1,2], function(){
        queue.enqueue(specHelper.queue, "uniqueJob", [3,4], function(){
          specHelper.redis.zcount(specHelper.namespace + ":delayed_queue_schedule", '-inf', '+inf', function(err, delayedLen){
            queue.length(specHelper.queue, function(err, queueLen){
              delayedLen.should.equal(1);
              queueLen.should.equal(1);
              done();
            });
          });
        });
      });
    });

  });

})