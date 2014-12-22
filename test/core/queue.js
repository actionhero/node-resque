var specHelper = require(__dirname + "/../_specHelper.js").specHelper;
var should = require('should');

describe('queue', function(){

  var queue;

  it("can connect", function(done){
    queue = new specHelper.NR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue}, function(){
      should.exist(queue);
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
    queue = new specHelper.NR.queue({connection: connectionDetails, queue: specHelper.queue}, function(err){
      if(resolved === false){ // new versions of redis will keep retrying in node v0.11x... 
        should.exist(err);
        resolved = true;
        done();
      }
    });
  });

  describe('[with connection]', function(){

    before(function(done){
      specHelper.connect(function(){
        queue = new specHelper.NR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue}, function(){
          done();
        });
      });
    });

    beforeEach(function(done){
      specHelper.cleanup(function(){
        done();
      });
    });

    after(function(done){
      specHelper.cleanup(function(){
        done();
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
          String(score).should.equal("10");
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
          String(score).should.equal(String(now));
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
          });
        });
      });
    });

    it('can find previously scheduled jobs', function(done){
      queue.enqueueAt(10000, specHelper.queue, 'someJob', [1,2,3], function(){
        queue.scheduledAt(specHelper.queue, 'someJob', [1,2,3], function(err, timestamps){
          timestamps.length.should.equal(1);
          timestamps[0].should.equal('10');
          done();
        });
      });
    });

    it('will not match previously scheduled jobs with differnt args', function(done){
      queue.enqueueAt(10000, specHelper.queue, 'someJob', [1,2,3], function(){
        queue.scheduledAt(specHelper.queue, 'someJob', [3,2,1], function(err, timestamps){
          timestamps.length.should.equal(0);
          done();
        });
      });
    });

    it('can deleted an enqued job', function(done){
      queue.enqueue(specHelper.queue, 'someJob', [1,2,3], function(){
        queue.length(specHelper.queue, function(err, len){
          len.should.equal(1);
          queue.del(specHelper.queue, 'someJob', [1,2,3], function(){
            queue.length(specHelper.queue, function(err, len){
              len.should.equal(0);
              done();
            });
          });
        });
      });
    });

    it('can deleted a delayed job', function(done){
      queue.enqueueAt(10000, specHelper.queue, 'someJob', [1,2,3], function(){
        queue.delDelayed(specHelper.queue, 'someJob', [1,2,3], function(err, timestamps){
          timestamps.length.should.equal(1);
          timestamps[0].should.equal('10');
          done();
        });
      });
    });

    describe('delayed status', function(){

      beforeEach(function(done){
        queue.enqueueAt(10000, specHelper.queue, 'job1', [1,2,3], function(){
        queue.enqueueAt(10000, specHelper.queue, 'job2', [1,2,3], function(){
        queue.enqueueAt(20000, specHelper.queue, 'job3', [1,2,3], function(){
          done();
        });
        });
        });
      });

      it('can list the timestamps that exist', function(done){
        queue.timestamps(function(err, timestamps){
          should.not.exist(err);
          timestamps.length.should.equal(2);
          timestamps[0].should.equal(10000);
          timestamps[1].should.equal(20000);
          done();
        });
      });

      it('can list the jobs delayed at a timestamp', function(done){
        queue.delayedAt(10000, function(err, tasks_a){
          should.not.exist(err);
          tasks_a.length.should.equal(2);
          tasks_a[0].class.should.equal('job1');
          tasks_a[1].class.should.equal('job2');
          queue.delayedAt(20000, function(err, tasks_b){ 
            should.not.exist(err);
            tasks_b.length.should.equal(1);
            tasks_b[0].class.should.equal('job3');
            done();
          });
        });
      });

      it('can also return a hash with all delayed tasks', function(done){
        queue.allDelayed(function(err, hash){
          Object.keys(hash).length.should.equal(2);
          Object.keys(hash)[0].should.equal('10000');
          Object.keys(hash)[1].should.equal('20000');
          hash['10000'].length.should.equal(2);
          hash['20000'].length.should.equal(1);
          done();
        });
      });

    });

    describe('worker status', function(){
      var workerA;
      var workerB;
      var timeout = 100;

      var jobs = {
        "slowJob": {
          perform: function(callback){
            setTimeout(function(){
              callback(null);
            }, timeout)
          }
        }
      };

      beforeEach(function(done){
        workerA = new specHelper.NR.worker({
          connection: specHelper.connectionDetails, 
          timeout: specHelper.timeout, 
          queues: specHelper.queue, 
          name: 'workerA'
        }, jobs, function(){
        workerB = new specHelper.NR.worker({
          connection: specHelper.connectionDetails, 
          timeout: specHelper.timeout, 
          queues: specHelper.queue, 
          name: 'workerB'
        }, jobs, function(){
          workerA.init(function(){
          workerB.init(function(){
            done();
          });
          });
        }); });
      });

      afterEach(function(done){
        workerA.end(function(){
        workerB.end(function(){
          done();
        });
        });
      });

      it('can list running workers', function(done){
        queue.workers(function(err, workers){
          should.not.exist(err);
          workers['workerA'].should.equal('test_queue');
          workers['workerB'].should.equal('test_queue');
          done();
        });
      });

      it('we can see what workers are working on (idle)', function(done){
        queue.allWorkingOn(function(err, data){
          should.not.exist(err);
          data.should.containEql({'workerA': 'started'});
          data.should.containEql({'workerB': 'started'});
          done();
        });
      });

      it('we can see what workers are working on (active)', function(done){
        var listener = workerA.on('job', function(q, job, failure){
          workerA.removeAllListeners('job');
          
          queue.allWorkingOn(function(err, data){
            should.not.exist(err);
            data.should.containEql({'workerB': 'started'});
            var paylaod = data['workerA'].payload;
            paylaod.queue.should.equal('test_queue');
            paylaod.class.should.equal('slowJob');

            done();
          });          
        });

        queue.enqueue(specHelper.queue, "slowJob");
        workerA.start();
      });
    });

  });

});