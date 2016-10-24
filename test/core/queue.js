var specHelper = require(__dirname + '/../_specHelper.js').specHelper;
var should = require('should');

describe('queue', function(){

  var queue;

  it('can connect', function(done){
    queue = new specHelper.NR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue});
    queue.connect(function(error){
      should.not.exist(error);
      should.exist(queue);
      queue.end(done);
    });
  });

  it('can provide an error if connection failed', function(done){
    // Only run this test if this is using real redis
    if(process.env.FAKEREDIS === 'true' || process.env.FAKEREDIS === true){
      return done();
    }

    var connectionDetails = {
      pkg:       specHelper.connectionDetails.pkg,
      host:      'wronghostname',
      password:  specHelper.connectionDetails.password,
      port:      specHelper.connectionDetails.port,
      database:  specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace,
    };

    queue = new specHelper.NR.queue({connection: connectionDetails, queue: specHelper.queue});
    queue.connect(function(){
      throw new Error('should not get here');
    });

    queue.on('error', function(error){
      error.message.should.match(/getaddrinfo ENOTFOUND/);
      queue.end(done);
    });
  });

  describe('[with connection]', function(){

    before(function(done){
      specHelper.connect(function(){
        queue = new specHelper.NR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue});
        queue.connect(done);
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
      queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3], function(){
        specHelper.popFromQueue(function(err, obj){
          should.exist(obj);
          obj = JSON.parse(obj);
          obj['class'].should.equal('someJob');
          obj.args.should.eql([1, 2, 3]);
          done();
        });
      });
    });

    it('can add delayed job (enqueueAt)', function(done){
      queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3], function(error){
        should.not.exist(error);
        specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', '10', function(err, score){
          String(score).should.equal('10');
          specHelper.redis.lpop(specHelper.namespace + ':delayed:' + '10', function(err, obj){
            should.exist(obj);
            obj = JSON.parse(obj);
            obj['class'].should.equal('someJob');
            obj.args.should.eql([1, 2, 3]);
            done();
          });
        });
      });
    });

    it('can add delayed job whose timestamp is a string (enqueueAt)', function(done){
      queue.enqueueAt('10000', specHelper.queue, 'someJob', [1, 2, 3], function(error){
        should.not.exist(error);
        specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', '10', function(err, score){
          String(score).should.equal('10');
          specHelper.redis.lpop(specHelper.namespace + ':delayed:' + '10', function(err, obj){
            should.exist(obj);
            obj = JSON.parse(obj);
            obj['class'].should.equal('someJob');
            obj.args.should.eql([1, 2, 3]);
            done();
          });
        });
      });
    });

    it('will not enqueue a delayed job at the same time with matching params', function(done){
      queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3], function(error){
        should.not.exist(error);
        queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3], function(error){
          String(error).should.equal('Error: Job already enqueued at this time with same arguments');
          done();
        });
      });
    });

    it('can add delayed job (enqueueIn)', function(done){
      var now = Math.round(new Date().getTime() / 1000) + 5;
      queue.enqueueIn(5 * 1000, specHelper.queue, 'someJob', [1, 2, 3], function(){
        specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', now, function(err, score){
          String(score).should.equal(String(now));
          specHelper.redis.lpop(specHelper.namespace + ':delayed:' + now, function(err, obj){
            should.exist(obj);
            obj = JSON.parse(obj);
            obj['class'].should.equal('someJob');
            obj.args.should.eql([1, 2, 3]);
            done();
          });
        });
      });
    });

    it('can add a delayed job whose time is a string (enqueueIn)', function(done){
      var now = Math.round(new Date().getTime() / 1000) + 5;
      var time = 5 * 1000;
      queue.enqueueIn(time.toString(), specHelper.queue, 'someJob', [1, 2, 3], function(){
        specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', now, function(err, score){
          String(score).should.equal(String(now));
          specHelper.redis.lpop(specHelper.namespace + ':delayed:' + now, function(err, obj){
            should.exist(obj);
            obj = JSON.parse(obj);
            obj['class'].should.equal('someJob');
            obj.args.should.eql([1, 2, 3]);
            done();
          });
        });
      });
    });

    it('can get the number of jobs currently enqueued', function(done){
      queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3], function(){
        queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3], function(){
          queue.length(specHelper.queue, function(err, len){
            len.should.equal(2);
            done();
          });
        });
      });
    });

    it('can get the jobs in the queue', function(done){
      queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3], function(){
        queue.enqueue(specHelper.queue, 'someJob', [4, 5, 6], function(){
          queue.queued(specHelper.queue, 0, -1, function(err, jobs){
            jobs.length.should.equal(2);
            jobs[0].args.should.eql([1, 2, 3]);
            jobs[1].args.should.eql([4, 5, 6]);
            done();
          });
        });
      });
    });

    it('can find previously scheduled jobs', function(done){
      queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3], function(){
        queue.scheduledAt(specHelper.queue, 'someJob', [1, 2, 3], function(err, timestamps){
          timestamps.length.should.equal(1);
          timestamps[0].should.equal('10');
          done();
        });
      });
    });

    it('will not match previously scheduled jobs with differnt args', function(done){
      queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3], function(){
        queue.scheduledAt(specHelper.queue, 'someJob', [3, 2, 1], function(err, timestamps){
          timestamps.length.should.equal(0);
          done();
        });
      });
    });

    it('can deleted an enqued job', function(done){
      queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3], function(){
        queue.length(specHelper.queue, function(err, len){
          len.should.equal(1);
          queue.del(specHelper.queue, 'someJob', [1, 2, 3], function(){
            queue.length(specHelper.queue, function(err, len){
              len.should.equal(0);
              done();
            });
          });
        });
      });
    });

    it('can deleted a delayed job', function(done){
      queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3], function(){
        queue.delDelayed(specHelper.queue, 'someJob', [1, 2, 3], function(err, timestamps){
          timestamps.length.should.equal(1);
          timestamps[0].should.equal('10');
          done();
        });
      });
    });

    it('can delete a delayed job, and delayed queue should be empty', function(done){
      queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3], function(){
        queue.delDelayed(specHelper.queue, 'someJob', [1, 2, 3], function(err, timestamps){
          queue.allDelayed(function(err, hash){
            hash.should.be.empty();
            timestamps.length.should.equal(1);
            timestamps[0].should.equal('10');
            done();
          });
        });
      });
    });

    it('can handle single arguments without explicit array', function(done){
      queue.enqueue(specHelper.queue, 'someJob', 1, function(){
        specHelper.popFromQueue(function(err, obj){
          JSON.parse(obj).args.should.eql([1]);
          done();
        });
      });
    });

    it('allows omitting arguments when enqueuing', function(done){
      queue.enqueue(specHelper.queue, 'noParams'); // no callback here, but in practice will finish before next enqueue calls back
      queue.enqueue(specHelper.queue, 'noParams', function(){
        queue.length(specHelper.queue, function(err, len){
          len.should.equal(2);
          specHelper.popFromQueue(function(err, obj){
            obj = JSON.parse(obj);
            obj['class'].should.equal('noParams');
            obj.args.should.be.empty;
            specHelper.popFromQueue(function(err, obj){
              obj = JSON.parse(obj);
              obj['class'].should.equal('noParams');
              obj.args.should.be.empty;
              done();
            });
          });
        });
      });
    });

    it('allows omitting arguments when deleting', function(done){
      queue.enqueue(specHelper.queue, 'noParams', [], function(){
        queue.enqueue(specHelper.queue, 'noParams', [], function(){
          queue.length(specHelper.queue, function(err, len){
            len.should.equal(2);
            queue.del(specHelper.queue, 'noParams', function(err, let){
              should.not.exist(err);
              len.should.equal(2);
              queue.del(specHelper.queue, 'noParams', function(err, len){
                should.not.exist(err);
                len.should.equal(0);
                queue.length(specHelper.queue, function(err, len){
                  len.should.equal(0);
                  done();
                });
              });
            });
          });
        });
      });
    });

    it('allows omitting arguments when adding delayed job', function(done){
      queue.allDelayed(function(error, hash){
        should.not.exist(error);
        hash.should.be.empty;
        queue.enqueueAt(10000, specHelper.queue, 'noParams', function(error){
          should.not.exist(error);
          queue.enqueueIn(11000, specHelper.queue, 'noParams', function(error){
            should.not.exist(error);
            queue.enqueueAt(12000, specHelper.queue, 'noParams', function(error){
              should.not.exist(error);
              queue.enqueueIn(13000, specHelper.queue, 'noParams', function(error){
                should.not.exist(error);
                queue.scheduledAt(specHelper.queue, 'noParams', function(error, timestamps){
                  should.not.exist(error);
                  timestamps.length.should.equal(4);
                  queue.allDelayed(function(error, hash){
                    should.not.exist(error);
                    Object.keys(hash).length.should.equal(4);
                    for(var key in hash){
                      hash[key][0].args.should.be.empty;
                    }
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });

    it('allows omitting arguments when deleting a delayed job', function(done){
      queue.allDelayed(function(err, hash){
        hash.should.be.empty;
        queue.enqueueAt(10000, specHelper.queue, 'noParams');
        queue.enqueueAt(12000, specHelper.queue, 'noParams', function(){
          queue.allDelayed(function(err, hash){
            Object.keys(hash).length.should.equal(2);
            queue.delDelayed(specHelper.queue, 'noParams', function(){
              queue.delDelayed(specHelper.queue, 'noParams', function(){
                queue.allDelayed(function(err, hash){
                  hash.should.be.empty;
                  done();
                });
              });
            });
          });
        });
      });
    });

    it('can load stats', function(done){
      queue.connection.redis.set(specHelper.namespace + ':stat:failed', 1);
      queue.connection.redis.set(specHelper.namespace + ':stat:processed', 2);
      queue.stats(function(err, stats){
        should.not.exist(err);
        stats.processed.should.equal('2');
        stats.failed.should.equal('1');
        done();
      });
    });

    describe('locks', function(){
      beforeEach(function(done){ queue.connection.redis.set(queue.connection.key('lock:lists:queueName:jobName:[{}]'), 123, done); });
      beforeEach(function(done){ queue.connection.redis.set(queue.connection.key('workerslock:lists:queueName:jobName:[{}]'), 456, done); });

      afterEach(function(done){ queue.connection.redis.del(queue.connection.key('lock:lists:queueName:jobName:[{}]'), done); });
      afterEach(function(done){ queue.connection.redis.del(queue.connection.key('workerslock:lists:queueName:jobName:[{}]'), done); });

      it('can get locks', function(done){
        queue.locks(function(err, locks){
          should.not.exist(err);
          Object.keys(locks).length.should.equal(2);
          locks['lock:lists:queueName:jobName:[{}]'].should.equal('123');
          locks['workerslock:lists:queueName:jobName:[{}]'].should.equal('456');
          done();
        });
      });

      it('can remove locks', function(done){
        queue.locks(function(err, locks){
          should.not.exist(err);
          Object.keys(locks).length.should.equal(2);
          queue.delLock('workerslock:lists:queueName:jobName:[{}]', function(err, count){
            should.not.exist(err);
            count.should.equal(1);
            done();
          });
        });
      });
    });

    describe('failed job managment', function(){

      beforeEach(function(done){

        var errorPayload = function(id){
          return JSON.stringify({
            worker: 'busted-worker-' + id,
            queue: 'busted-queue',
            payload: {
              'class': 'busted_job',
              queue: 'busted-queue',
              args: [1, 2, 3]
            },
            exception: 'ERROR_NAME',
            error: 'I broke',
            failed_at: (new Date()).toString()
          });
        };

        queue.connection.redis.rpush(queue.connection.key('failed'), errorPayload(1), function(){
          queue.connection.redis.rpush(queue.connection.key('failed'), errorPayload(2), function(){
            queue.connection.redis.rpush(queue.connection.key('failed'), errorPayload(3), function(){
              done();
            });
          });
        });

      });

      it('can list how many failed jobs there are', function(done){
        queue.failedCount(function(err, failedCount){
          should.not.exist(err);
          failedCount.should.equal(3);
          done();
        });
      });

      it('can get the body content for a collection of failed jobs', function(done){
        queue.failed(1, 2, function(err, failedJobs){
          should.not.exist(err);
          failedJobs.length.should.equal(2);

          failedJobs[0].worker.should.equal('busted-worker-2');
          failedJobs[0].queue.should.equal('busted-queue');
          failedJobs[0].exception.should.equal('ERROR_NAME');
          failedJobs[0].error.should.equal('I broke');
          failedJobs[0].payload.args.should.eql([1, 2, 3]);

          failedJobs[1].worker.should.equal('busted-worker-3');
          failedJobs[1].queue.should.equal('busted-queue');
          failedJobs[1].exception.should.equal('ERROR_NAME');
          failedJobs[1].error.should.equal('I broke');
          failedJobs[1].payload.args.should.eql([1, 2, 3]);

          done();
        });
      });

      it('can remove a failed job by payload', function(done){
        queue.failed(1, 1, function(err, failedJobs){
          failedJobs.length.should.equal(1);
          queue.removeFailed(failedJobs[0], function(err, removedJobs){
            should.not.exist(err);
            removedJobs.should.equal(1);
            queue.failedCount(function(err, failedCount){
              failedCount.should.equal(2);
              done();
            });
          });
        });
      });

      it('can re-enqueue a specific job, removing it from the failed queue', function(done){
        queue.failed(0, 999, function(err, failedJobs){
          failedJobs.length.should.equal(3);
          failedJobs[2].worker.should.equal('busted-worker-3');
          queue.retryAndRemoveFailed(failedJobs[2], function(err, retriedJob){
            should.not.exist(err);
            queue.failed(0, 999, function(err, failedJobs){
              failedJobs.length.should.equal(2);
              failedJobs[0].worker.should.equal('busted-worker-1');
              failedJobs[1].worker.should.equal('busted-worker-2');
              done();
            });
          });
        });
      });

      it('will return an error when trying to retry a job not in the failed queue', function(done){
        queue.failed(0, 999, function(err, failedJobs){
          failedJobs.length.should.equal(3);
          var failedJob = failedJobs[2];
          failedJob.worker = 'a-fake-worker';
          queue.retryAndRemoveFailed(failedJob, function(err, retriedJob){
            String(err).should.eql('Error: This job is not in failed queue');
            queue.failed(0, 999, function(err, failedJobs){
              failedJobs.length.should.equal(3);
              done();
            });
          });
        });
      });

    });

    describe('delayed status', function(){

      beforeEach(function(done){
        queue.enqueueAt(10000, specHelper.queue, 'job1', [1, 2, 3], function(){
          queue.enqueueAt(10000, specHelper.queue, 'job2', [1, 2, 3], function(){
            queue.enqueueAt(20000, specHelper.queue, 'job3', [1, 2, 3], function(){
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
          tasks_a[0]['class'].should.equal('job1');
          tasks_a[1]['class'].should.equal('job2');
          queue.delayedAt(20000, function(err, tasks_b){
            should.not.exist(err);
            tasks_b.length.should.equal(1);
            tasks_b[0]['class'].should.equal('job3');
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
      var timeout = 500;

      var jobs = {
        'slowJob': {
          perform: function(callback){
            setTimeout(function(){
              callback(null);
            }, timeout);
          }
        }
      };

      beforeEach(function(done){
        workerA = new specHelper.NR.worker({
          connection: specHelper.connectionDetails,
          timeout: specHelper.timeout,
          queues: specHelper.queue,
          name: 'workerA'
        }, jobs);


        workerB = new specHelper.NR.worker({
          connection: specHelper.connectionDetails,
          timeout: specHelper.timeout,
          queues: specHelper.queue,
          name: 'workerB'
        }, jobs);

        workerA.connect(function(){
          workerB.connect(function(){
            workerA.init(function(){
              workerB.init(function(){
                done();
              });
            });
          });
        });
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
          workers.workerA.should.equal('test_queue');
          workers.workerB.should.equal('test_queue');
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
            var paylaod = data.workerA.payload;
            paylaod.queue.should.equal('test_queue');
            paylaod['class'].should.equal('slowJob');

            done();
          });
        });

        queue.enqueue(specHelper.queue, 'slowJob');
        workerA.start();
      });

      it('can remove stuck workers', function(done){
        var age = 1;
        var listener = workerA.on('job', function(q, job, failure){
          workerA.removeAllListeners('job');

          queue.allWorkingOn(function(err, data){
            var paylaod = data.workerA.payload;
            paylaod.queue.should.equal('test_queue');
            paylaod['class'].should.equal('slowJob');

            queue.cleanOldWorkers(age, function(err, data){
              should.not.exist(err);
              Object.keys(data).length.should.equal(1);
              data.workerA.queue.should.equal('test_queue');
              data.workerA.worker.should.equal('workerA');
              data.workerA.payload['class'].should.equal('slowJob');
              specHelper.redis.rpop(specHelper.namespace + ':' + 'failed', function(err, data){
                data = JSON.parse(data);
                data.queue.should.equal(specHelper.queue);
                data.exception.should.equal('Worker Timeout (killed manually)');
                data.error.should.equal('Worker Timeout (killed manually)');
                data.payload['class'].should.equal('slowJob');

                queue.allWorkingOn(function(err, data){
                  Object.keys(data).length.should.equal(1);
                  data.workerB.should.equal('started');
                  done();
                });
              });
            });
          });
        });

        queue.enqueue(specHelper.queue, 'slowJob');
        workerA.start();
      });

      it('will not remove stuck jobs within the timelimit', function(done){
        var age = 999;
        var listener = workerA.on('job', function(q, job, failure){
          workerA.removeAllListeners('job');

          queue.cleanOldWorkers(age, function(err, data){
            should.not.exist(err);
            Object.keys(data).length.should.equal(0);
            queue.allWorkingOn(function(err, data){
              var paylaod = data.workerA.payload;
              paylaod.queue.should.equal('test_queue');
              paylaod['class'].should.equal('slowJob');

              done();
            });
          });
        });

        queue.enqueue(specHelper.queue, 'slowJob');
        workerA.start();
      });

    });

  });

});
