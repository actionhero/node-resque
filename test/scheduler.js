describe('scheduler', function(){

  var specHelper = require(__dirname + "/_specHelper.js").specHelper;
  var should = require('should');
  var scheduler;
  var queue;
  
  before(function(done){
    specHelper.connect(function(){
      specHelper.cleanup(function(){
        queue = new specHelper.AR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue}, function(){
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

  it("can connect", function(done){
    scheduler = new specHelper.AR.scheduler({connection: specHelper.connectionDetails, timeout: specHelper.timeout}, function(){
      should.exist(scheduler);
      done()
    });
  });

  it("can boot", function(done){
    scheduler.start();
    done()
  });

  it('can be stopped', function(done){
    this.timeout(specHelper.timeout * 3)
    scheduler.end(function(){
      done();
    });
  });

  it("will move enqueued jobs when the time comes", function(done){
    queue.enqueueAt(1000 * 10, 'someJob', [1,2,3], function(){
      scheduler.poll(function(){
        specHelper.popFromQueue(function(err, obj){
          should.exist(obj);
          obj = JSON.parse(obj);
          obj['class'].should.equal('someJob');
          // obj['args'].should.equal([1,2,3]);
          done();
        });
      });
    });
  });

  it("will not move jobs in the future", function(done){
    done()
  });

});