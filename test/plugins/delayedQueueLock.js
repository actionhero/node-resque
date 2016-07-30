var specHelper = require(__dirname + '/../_specHelper.js').specHelper;
var should = require('should');

describe('plugins', function(){
  var queue;
  var jobDelay = 100;

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

  after(function(done){
    queue.end(function(){
      specHelper.cleanup(done);
    });
  });

  beforeEach(function(done){
    specHelper.cleanup(done);
  });

  describe('delayQueueLock', function(){

    it('will not enque a job with the same args if it is already in the delayed queue', function(done){
      queue.enqueueIn((10 * 1000), specHelper.queue, 'uniqueJob', [1, 2], function(){
        queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2], function(){
          specHelper.redis.zcount(specHelper.namespace + ':delayed_queue_schedule', '-inf', '+inf', function(err, delayedLen){
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
      queue.enqueueIn((10 * 1000), specHelper.queue, 'uniqueJob', [1, 2], function(){
        queue.enqueue(specHelper.queue, 'uniqueJob', [3, 4], function(){
          specHelper.redis.zcount(specHelper.namespace + ':delayed_queue_schedule', '-inf', '+inf', function(err, delayedLen){
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

});
