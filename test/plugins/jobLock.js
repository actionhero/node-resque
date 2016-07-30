var specHelper = require(__dirname + '/../_specHelper.js').specHelper;
var should = require('should');

describe('plugins', function(){
  var queue;
  var jobDelay = 1000;

  var jobs = {
    'slowAdd': {
      plugins: ['jobLock'],
      pluginOptions: { jobLock: {}, },
      perform: function(a, b, callback){
        var answer = a + b;
        setTimeout(function(){
          callback(null, answer);
        }, jobDelay);
      },
    },
    'uniqueJob': {
      plugins: ['queueLock', 'delayQueueLock'],
      pluginOptions: { queueLock: {}, delayQueueLock: {} },
      perform: function(a, b, callback){
        var answer = a + b;
        callback(null, answer);
      },
    }
  };

  before(function(done){
    specHelper.connect(function(){
      specHelper.cleanup(function(){
        queue = new specHelper.NR.queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs);
        queue.connect(done);
      });
    });
  });

  afterEach(function(done){
    specHelper.cleanup(done);
  });

  describe('jobLock', function(){
    var worker1;
    var worker2;

    it('will not lock jobs since arg objects are different', function(done){
      worker1 = new specHelper.NR.worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs);
      worker2 = new specHelper.NR.worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs);

      worker1.connect(function(){
        worker2.connect(function(){

          var startTime = new Date().getTime();
          var completed = 0;

          var onComplete = function(q, job, result){
            completed++;
            if(completed === 2){
              worker1.end();
              worker2.end();
              (new Date().getTime() - startTime).should.be.below(jobDelay * 2);
              done();
            }
          };

          worker1.on('success', onComplete);
          worker2.on('success', onComplete);
          queue.enqueue(specHelper.queue, 'slowAdd', [{name: 'Walter White'}, 2], function(){
            queue.enqueue(specHelper.queue, 'slowAdd', [{name: 'Jesse Pinkman'}, 2], function(){
              worker1.start();
              worker2.start();
            });
          });

          worker1.on('error', function(queue, job, error){ console.log(error.stack); });
          worker2.on('error', function(queue, job, error){ console.log(error.stack); });

        });
      });
    });

    it('allows the key to be specified as a function', function(done){
      var calls = 0;
      var jobs = {
        jobLockAdd: {
          plugins: ['jobLock'],
          pluginOptions: {
            jobLock: {
              key: function(){
                // Once to create, once to delete
                if(++calls === 2){
                  done();
                  worker1.end();
                }
                return this.worker.connection.key('customKey', Math.max.apply(Math.max, this.args));
              }
            }
          },
          perform: function(a, b, callback){
            callback(null, a + b);
          }
        }
      };

      worker1 = new specHelper.NR.worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs);
      worker1.connect(function(){
        queue.enqueue(specHelper.queue, 'jobLockAdd', [1, 2], function(){
          worker1.start();
        });
      });

      worker1.on('error', function(queue, job, error){ console.log(error.stack); });
    });

    it('will not run 2 jobs with the same args at the same time', function(done){
      worker1 = new specHelper.NR.worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs);
      worker2 = new specHelper.NR.worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs);

      worker1.connect(function(){
        worker2.connect(function(){

          var startTime = new Date().getTime();
          var completed = 0;

          var onComplete = function(q, job, result){
            completed++;
            if(completed === 2){
              worker1.end();
              worker2.end();
              (new Date().getTime() - startTime).should.be.above(jobDelay * 2);
              done();
            }
          };

          worker1.on('success', onComplete);
          worker2.on('success', onComplete);
          queue.enqueue(specHelper.queue, 'slowAdd', [1, 2], function(){
            queue.enqueue(specHelper.queue, 'slowAdd', [1, 2], function(){
              worker1.start();
              worker2.start();
            });
          });

          worker1.on('error', function(queue, job, error){ console.log(error.stack); });
          worker2.on('error', function(queue, job, error){ console.log(error.stack); });
        });

      });
    });

    it('will run 2 jobs with the different args at the same time', function(done){
      worker1 = new specHelper.NR.worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs);
      worker2 = new specHelper.NR.worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs);

      worker1.connect(function(){
        worker2.connect(function(){

          var startTime = new Date().getTime();
          var completed = 0;

          var onComplete = function(q, job, result){
            completed++;
            if(completed === 2){
              worker1.end();
              worker2.end();
              var delta = (new Date().getTime() - startTime);
              delta.should.be.below(jobDelay * 2);
              done();
            }
          };

          worker1.on('success', onComplete);
          worker2.on('success', onComplete);
          queue.enqueue(specHelper.queue, 'slowAdd', [1, 2], function(){
            queue.enqueue(specHelper.queue, 'slowAdd', [3, 4], function(){
              worker1.start();
              worker2.start();
            });
          });

          worker1.on('error', function(queue, job, error){ console.log(error.stack); });
          worker2.on('error', function(queue, job, error){ console.log(error.stack); });

        });
      });
    });
  });

});
