describe('worker', function(){

  var specHelper = require(__dirname + "/_specHelper.js").specHelper;
  var should = require('should');
  var os = require('os');
  var worker;
  var queue;

  var jobs = {
    "add": {
      perform: function(a,b,callback){
        var answer = a + b; 
        callback(answer);
      },
    } 
  };
  
  before(function(done){
    specHelper.connect(function(){
      specHelper.cleanup(function(){
        queue = new specHelper.NR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue}, function(){
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
    worker = new specHelper.NR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout}, jobs, function(){
      should.exist(worker);
      done()
    });
  });

  it("can boot", function(done){
    worker.start();
    done()
  });

  it('can be stopped', function(done){
    this.timeout(specHelper.timeout * 3)
    worker.end(function(){
      done();
    });
  });

  describe('crashing workers', function(){

    it('can clear previously crashed workers from the same host', function(done){
      var name1 = os.hostname() + ":" + "0" // fake pid
      var name2 = os.hostname() + ":" + process.pid // real pid
      worker1 = new specHelper.NR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, name: name1}, jobs, function(){
        worker1.init(function(){
          worker1.running = false;
          setTimeout(function(){
            worker2 = new specHelper.NR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, name: name2}, jobs, function(){
              worker2.on('cleaning_worker', function(worker, pid){
                worker.should.equal(name1 + ":*");
                pid.should.equal(0);
                done();
              });
              worker2.workerCleanup();
            });
          }, 500);
        });
      });    
    });

  });

  describe('integration', function(){

    beforeEach(function(done){
      worker = new specHelper.NR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue}, jobs, function(){
        done();
      });
    });

    afterEach(function(done){
      worker.end(function(){
        done();
      });
    });

    it('can work a job and return succesfull things', function(done){
      var listener = worker.on('success', function(q, job, result){
        q.should.equal(specHelper.queue);
        job.class.should.equal('add');
        result.should.equal(3);

        worker.removeAllListeners('success');
        done();
      })

      queue.enqueue(specHelper.queue, "add", [1,2]);
      worker.start();
    });

    it('will not work jobs that are not defined', function(done){
      var listener = worker.on('error', function(q, job, error){
        q.should.equal(specHelper.queue);
        String(error).should.equal == "Error: No job defined for class 'somethingFake'";

        worker.removeAllListeners('error');
        done();
      })

      queue.enqueue(specHelper.queue, "somethingFake", []);
      worker.start();
    });

    it('will place failed jobs in the failed queue', function(done){
      specHelper.redis.rpop(specHelper.namespace + ":" + "failed", function(err, data){
        data = JSON.parse(data);
        data.queue.should.equal(specHelper.queue);
        data.exception.should.equal('Error');
        data.error.should.equal('No job defined for class \'somethingFake\'');

        done();
      })
    });


  });  

});