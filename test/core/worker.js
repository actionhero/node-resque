var specHelper = require(__dirname + "/../_specHelper.js").specHelper;
var should = require('should');

describe('worker', function(){

  var os = require('os');
  var worker;
  var queue;

  var jobs = {
    "add": {
      perform: function(a,b,callback){
        var answer = a + b;
        callback(null, answer);
      }
    },
    "badAdd": {
      perform: function(a,b,callback){
        callback(new Error("Blue Smoke"));
      }
    },
    "doubleCaller":{
      perform: function(callback){
        callback(null, 'a');
        setTimeout(function(){ callback(null, 'b'); }, 500);
        setTimeout(function(){ callback(null, 'c'); }, 1000);
      }
    },
    "quickDefine": function(callback) {
      setTimeout(callback.bind(null, null, "ok"));
    },
  };

  it("can connect", function(done){
    worker = new specHelper.NR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout}, jobs, function(){
      should.exist(worker);
      worker.end();
      done();
    });
  });

  it("can provide an error if connection failed", function(done) {
    // Only run this test if this is using real redis
    if(process.env.FAKEREDIS == 'true') {
      return done();
    }

    // Make a copy of the connectionDetails so we don't overwrite the original one
    var connectionDetails = {
      package:   specHelper.connectionDetails.package,
      host:      "wronghostname",
      password:  specHelper.connectionDetails.password,
      port:      "wrongport",
      database:  specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace,
    };

    resolved = false;
    worker = new specHelper.NR.worker({connection: connectionDetails, timeout: specHelper.timeout}, jobs, function(err){
      if(resolved === false){ // new versions of redis will keep retrying in node v0.11x... 
        should.exist(err);
        resolved = true;
        done();
      }
    });
  });

  describe('[with connection]', function() {

    before(function(done){
      specHelper.connect(function(){
        queue = new specHelper.NR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue}, function(){
          done();
        });
      });
    });

    after(function(done){
      specHelper.cleanup(function(){
        done();
      });
    });

    it("can boot and stop", function(done){
      this.timeout(specHelper.timeout * 3);
      worker.start();
      worker.end(function(){
        done();
      });
    });

    describe('crashing workers', function(){

      it('can clear previously crashed workers from the same host', function(done){
        var name1 = os.hostname() + ":" + "0"; // fake pid
        var name2 = os.hostname() + ":" + process.pid; // real pid
        var worker1 = new specHelper.NR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, name: name1}, jobs, function(){
          worker1.init(function(){
            worker1.running = false;
            setTimeout(function(){
              var worker2 = new specHelper.NR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, name: name2}, jobs, function(){
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

      it("will mark a job as failed", function(done){
        var listener = worker.on('failure', function(q, job, failire){
          q.should.equal(specHelper.queue);
          job.class.should.equal('badAdd');
          failire.message.should.equal('Blue Smoke');

          worker.removeAllListeners('failire');
          done();
        });

        queue.enqueue(specHelper.queue, "badAdd", [1,2]);
        worker.start();
      });

      it('can work a job and return succesful things', function(done){
        var listener = worker.on('success', function(q, job, result){
          q.should.equal(specHelper.queue);
          job.class.should.equal('add');
          result.should.equal(3);

          worker.removeAllListeners('success');
          done();
        });

        queue.enqueue(specHelper.queue, "add", [1,2]);
        worker.start();
      });

      it('can accept jobs that are simple functions', function(done){
        var listener = worker.on('success', function(q, job, result){
          result.should.equal("ok");

          worker.removeAllListeners('success');
          done();
        });

        queue.enqueue(specHelper.queue, "quickDefine", []);
        worker.start();
      });


      it('will not work jobs that are not defined', function(done){
        var listener = worker.on('failure', function(q, job, failure){
          q.should.equal(specHelper.queue);
          String(failure).should.equal == "Error: No job defined for class 'somethingFake'";

          worker.removeAllListeners('failure');
          done();
        });

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
        });
      });

      it('will not double-work with a baddly defined job', function(done){
        var callbackCounts = 0;
        var expected = 3;
        var errorCounter = 0;
        var successCounter = 0;

        var errorListener = worker.on('failure', function(q, job, err){
          String(err).should.equal('Error: refusing to continue with job, multiple callbacks detected');
          callbackCounts++;
          errorCounter++;
          if(callbackCounts === expected){ complete(); }
        });

        var successListener = worker.on('success', function(q, job, result){
          result.should.equal('a');
          successCounter++;
          callbackCounts++;
          if(callbackCounts === expected){ complete(); }
        });

        var complete = function(){
          errorCounter.should.equal(2);
          successCounter.should.equal(1);
          worker.removeAllListeners('success');
          worker.removeAllListeners('failure');
          done();
        };

        queue.enqueue(specHelper.queue, "doubleCaller", []);
        worker.start();
      });

    });

  });

});
