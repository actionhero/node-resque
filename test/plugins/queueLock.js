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

  afterEach(function(done){
    specHelper.cleanup(done);
  });

  beforeEach(function(done){
    specHelper.cleanup(done);
  });

  describe('queueLock', function(){

    it('will not enque a job with the same args if it is already in the queue', function(done){
      queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2], function(){
        queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2], function(){
          queue.length(specHelper.queue, function(err, len){
            len.should.equal(1);
            done();
          });
        });
      });
    });

    it('will enque a job with the different args', function(done){
      queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2], function(){
        queue.enqueue(specHelper.queue, 'uniqueJob', [3, 4], function(){
          queue.length(specHelper.queue, function(err, len){
            len.should.equal(2);
            done();
          });
        });
      });
    });
  });

});
