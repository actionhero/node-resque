describe('queue', function(){

  var specHelper = require(__dirname + "/_specHelper.js").specHelper;
  var should = require('should');
  var queue;
  
  before(function(done){
    specHelper.connect(function(){
      specHelper.cleanup(function(){
        done();
      });
    });
  });

  after(function(done){
    specHelper.cleanup(function(){
      done();
    });
  });

  it("can connect", function(done){
    queue = new specHelper.NR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue}, function(){
      should.exist(queue);
      done()
    });
  });

  it('can add a normal job', function(done){
    queue.enqueue(specHelper.queue, 'someJob', [1,2,3], function(){
      specHelper.popFromQueue(function(err, obj){
        should.exist(obj);
        obj = JSON.parse(obj);
        obj['class'].should.equal('someJob');
        // obj['args'].should.equal([1,2,3]);
        done();
      });
    });
  });

  it('can add delayed job (enqueueAt)', function(done){
    queue.enqueueAt(10000, specHelper.queue, 'someJob', [1,2,3], function(){
      specHelper.redis.zscore(specHelper.namespace + ":delayed_queue_schedule", "10", function(err, score){
        score.should.equal("10");
        specHelper.redis.lpop(specHelper.namespace + ":delayed:" + "10", function(err, obj){
          should.exist(obj);
          obj = JSON.parse(obj);
          obj['class'].should.equal('someJob');
          // obj['args'].should.equal([1,2,3]);
          done();        
        });
      });
    });
  });

  it('can add delayed job (enqueueIn)', function(done){
    var now = Math.round( new Date().getTime() / 1000 ) + 5;
    queue.enqueueIn(5 * 1000, specHelper.queue, 'someJob', [1,2,3], function(){
      specHelper.redis.zscore(specHelper.namespace + ":delayed_queue_schedule", now, function(err, score){
        score.should.equal(String(now));
        specHelper.redis.lpop(specHelper.namespace + ":delayed:" + now, function(err, obj){
          should.exist(obj);
          obj = JSON.parse(obj);
          obj['class'].should.equal('someJob');
          // obj['args'].should.equal([1,2,3]);
          done();        
        });
      });
    });
  });

  it('can get the number of jobs currently enqueued', function(done){
    queue.enqueue(specHelper.queue, 'someJob', [1,2,3], function(){
      queue.enqueue(specHelper.queue, 'someJob', [1,2,3], function(){
        queue.length(specHelper.queue, function(err, len){
          len.should.equal(2);
          done();
        })
      });
    })
  });

});