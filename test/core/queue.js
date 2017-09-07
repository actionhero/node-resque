const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should')
let queue

describe('queue', () => {
  it('can connect', async () => {
    var Queue = specHelper.NR.Queue
    queue = new Queue({connection: specHelper.connectionDetails, queue: specHelper.queue})
    await queue.connect()
    await queue.end()
  })

  it('can provide an error if connection failed', async () => {
    let connectionDetails = {
      pkg: specHelper.connectionDetails.pkg,
      host: 'wronghostname',
      password: specHelper.connectionDetails.password,
      port: specHelper.connectionDetails.port,
      database: specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace
    }

    var Queue = specHelper.NR.Queue
    queue = new Queue({connection: connectionDetails, queue: specHelper.queue})

    await new Promise((resolve) => {
      queue.connect()

      queue.on('error', (error) => {
        error.message.should.match(/getaddrinfo ENOTFOUND/)
        queue.end()
        resolve()
      })
    })
  })

  describe('[with connection]', function () {
    before(async () => {
      await specHelper.connect()
      var Queue = specHelper.NR.Queue
      queue = new Queue({connection: specHelper.connectionDetails, queue: specHelper.queue})
      await queue.connect()
    })

    beforeEach(async () => { await specHelper.cleanup() })
    after(async () => { await specHelper.cleanup() })

    it('can add a normal job', async () => {
      await queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3])
      let obj = await specHelper.popFromQueue()
      should.exist(obj)
      obj = JSON.parse(obj)
      obj['class'].should.equal('someJob')
      obj.args.should.eql([1, 2, 3])
    })

    it('can add delayed job (enqueueAt)', async () => {
      await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
      let score = await specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', '10')
      String(score).should.equal('10')

      let obj = await specHelper.redis.lpop(specHelper.namespace + ':delayed:' + '10')
      should.exist(obj)
      obj = JSON.parse(obj)
      obj['class'].should.equal('someJob')
      obj.args.should.eql([1, 2, 3])
    })

    it('can add delayed job whose timestamp is a string (enqueueAt)', async () => {
      await queue.enqueueAt('10000', specHelper.queue, 'someJob', [1, 2, 3])
      let score = await specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', '10')
      String(score).should.equal('10')

      let obj = await specHelper.redis.lpop(specHelper.namespace + ':delayed:' + '10')
      should.exist(obj)
      obj = JSON.parse(obj)
      obj['class'].should.equal('someJob')
      obj.args.should.eql([1, 2, 3])
    })

    it('will not enqueue a delayed job at the same time with matching params', async () => {
      await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
      try {
        await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
        throw new Error('should not get here')
      } catch (error) {
        String(error).should.equal('Error: Job already enqueued at this time with same arguments')
      }
    })

    it('can add delayed job (enqueueIn)', async () => {
      let now = Math.round(new Date().getTime() / 1000) + 5
      await queue.enqueueIn(5 * 1000, specHelper.queue, 'someJob', [1, 2, 3])
      let score = await specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', now)
      String(score).should.equal(String(now))

      let obj = await specHelper.redis.lpop(specHelper.namespace + ':delayed:' + now)
      should.exist(obj)
      obj = JSON.parse(obj)
      obj['class'].should.equal('someJob')
      obj.args.should.eql([1, 2, 3])
    })

    it('can add a delayed job whose time is a string (enqueueIn)', async () => {
      let now = Math.round(new Date().getTime() / 1000) + 5
      let time = 5 * 1000

      await queue.enqueueIn(time.toString(), specHelper.queue, 'someJob', [1, 2, 3])
      let score = await specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', now)
      String(score).should.equal(String(now))

      let obj = await specHelper.redis.lpop(specHelper.namespace + ':delayed:' + now)
      should.exist(obj)
      obj = JSON.parse(obj)
      obj['class'].should.equal('someJob')
      obj.args.should.eql([1, 2, 3])
    })

    it('can get the number of jobs currently enqueued', async () => {
      await queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3])
      await queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3])
      let length = await queue.length(specHelper.queue)
      length.should.equal(2)
    })

    it('can get the jobs in the queue', async () => {
      await queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3])
      await queue.enqueue(specHelper.queue, 'someJob', [4, 5, 6])
      let jobs = await queue.queued(specHelper.queue, 0, -1)
      jobs.length.should.equal(2)
      jobs[0].args.should.eql([1, 2, 3])
      jobs[1].args.should.eql([4, 5, 6])
    })

    it('can find previously scheduled jobs', async () => {
      await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
      let timestamps = await queue.scheduledAt(specHelper.queue, 'someJob', [1, 2, 3])
      timestamps.length.should.equal(1)
      timestamps[0].should.equal('10')
    })

    it('will not match previously scheduled jobs with differnt args', async () => {
      await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
      let timestamps = await queue.scheduledAt(specHelper.queue, 'someJob', [3, 2, 1])
      timestamps.length.should.equal(0)
    })

    it('can deleted an enqued job', async () => {
      await queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3])
      let length = await queue.length(specHelper.queue)
      length.should.equal(1)

      await queue.del(specHelper.queue, 'someJob', [1, 2, 3])
      let lengthAgain = await queue.length(specHelper.queue)
      lengthAgain.should.equal(0)
    })

    it('can deleted a delayed job', async () => {
      await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
      let timestamps = await queue.delDelayed(specHelper.queue, 'someJob', [1, 2, 3])
      timestamps.length.should.equal(1)
      timestamps[0].should.equal('10')
    })

    it('can delete a delayed job, and delayed queue should be empty', async () => {
      await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
      let timestamps = await queue.delDelayed(specHelper.queue, 'someJob', [1, 2, 3])
      let hash = await queue.allDelayed()
      hash.should.be.empty()
      timestamps.length.should.equal(1)
      timestamps[0].should.equal('10')
    })

    it('can handle single arguments without explicit array', async () => {
      await queue.enqueue(specHelper.queue, 'someJob', 1)
      let obj = await specHelper.popFromQueue()
      JSON.parse(obj).args.should.eql([1])
    })

    it('allows omitting arguments when enqueuing', async () => {
      await queue.enqueue(specHelper.queue, 'noParams')
      let length = await queue.length(specHelper.queue)
      length.should.equal(1)
      let obj = await specHelper.popFromQueue()
      obj = JSON.parse(obj)
      obj['class'].should.equal('noParams');
      (Array.isArray(obj.args)).should.equal(true)
      obj.args.should.be.empty()
    })

    it('allows omitting arguments when deleting', async () => {
      await queue.enqueue(specHelper.queue, 'noParams', [])
      await queue.enqueue(specHelper.queue, 'noParams', [])
      let length = await queue.length(specHelper.queue)
      length.should.equal(2)

      let deletedCount = await queue.del(specHelper.queue, 'noParams')
      deletedCount.should.equal(2)

      let deletedCountAgain = await queue.del(specHelper.queue, 'noParams')
      deletedCountAgain.should.equal(0)
      let lengthAgain = await queue.length(specHelper.queue)
      lengthAgain.should.equal(0)
    })

    it('allows omitting arguments when adding delayed job', async () => {
      let hash = await queue.allDelayed()
      hash.should.be.empty()

      await queue.enqueueAt(10000, specHelper.queue, 'noParams', [])
      await queue.enqueueIn(11000, specHelper.queue, 'noParams', [])
      await queue.enqueueAt(12000, specHelper.queue, 'noParams', [])
      await queue.enqueueIn(13000, specHelper.queue, 'noParams', [])

      let timestamps = await queue.scheduledAt(specHelper.queue, 'noParams', [])
      timestamps.length.should.equal(4)
      let hashAgain = await queue.allDelayed()
      Object.keys(hashAgain).length.should.equal(4)
      for (var key in hashAgain) {
        hashAgain[key][0].args.should.be.empty();
        (Array.isArray(hashAgain[key][0].args)).should.equal(true)
      }
    })

    it('allows omitting arguments when deleting a delayed job', async () => {
      let hash = await queue.allDelayed()
      hash.should.be.empty()

      await queue.enqueueAt(10000, specHelper.queue, 'noParams')
      await queue.enqueueAt(12000, specHelper.queue, 'noParams')

      let hashAgain = await queue.allDelayed()
      Object.keys(hashAgain).length.should.equal(2)

      await queue.delDelayed(specHelper.queue, 'noParams')
      await queue.delDelayed(specHelper.queue, 'noParams')
      let hashThree = queue.allDelayed()
      hashThree.should.be.empty()
    })

    it('can load stats', async () => {
      await queue.connection.redis.set(specHelper.namespace + ':stat:failed', 1)
      await queue.connection.redis.set(specHelper.namespace + ':stat:processed', 2)

      let stats = await queue.stats()
      stats.processed.should.equal('2')
      stats.failed.should.equal('1')
    })

    describe('locks', () => {
      beforeEach(async () => {
        await queue.connection.redis.set(queue.connection.key('lock:lists:queueName:jobName:[{}]'), 123)
        await queue.connection.redis.set(queue.connection.key('workerslock:lists:queueName:jobName:[{}]'), 456)
      })

      afterEach(async () => {
        await queue.connection.redis.del(queue.connection.key('lock:lists:queueName:jobName:[{}]'))
        await queue.connection.redis.del(queue.connection.key('workerslock:lists:queueName:jobName:[{}]'))
      })

      it('can get locks', async () => {
        let locks = await queue.locks()
        Object.keys(locks).length.should.equal(2)
        locks['lock:lists:queueName:jobName:[{}]'].should.equal('123')
        locks['workerslock:lists:queueName:jobName:[{}]'].should.equal('456')
      })

      it('can remove locks', async () => {
        let locks = await queue.locks()
        Object.keys(locks).length.should.equal(2)
        let count = await queue.delLock('workerslock:lists:queueName:jobName:[{}]')
        count.should.equal(1)
      })
    })

    describe('failed job managment', () => {
      beforeEach(async () => {
        let errorPayload = function (id) {
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
          })
        }

        await queue.connection.redis.rpush(queue.connection.key('failed'), errorPayload(1))
        await queue.connection.redis.rpush(queue.connection.key('failed'), errorPayload(2))
        await queue.connection.redis.rpush(queue.connection.key('failed'), errorPayload(3))
      })

      it('can list how many failed jobs there are', async () => {
        let failedCount = await queue.failedCount()
        failedCount.should.equal(3)
      })

      it('can get the body content for a collection of failed jobs', async () => {
        let failedJobs = await queue.failed(1, 2)
        failedJobs.length.should.equal(2)

        failedJobs[0].worker.should.equal('busted-worker-2')
        failedJobs[0].queue.should.equal('busted-queue')
        failedJobs[0].exception.should.equal('ERROR_NAME')
        failedJobs[0].error.should.equal('I broke')
        failedJobs[0].payload.args.should.eql([1, 2, 3])

        failedJobs[1].worker.should.equal('busted-worker-3')
        failedJobs[1].queue.should.equal('busted-queue')
        failedJobs[1].exception.should.equal('ERROR_NAME')
        failedJobs[1].error.should.equal('I broke')
        failedJobs[1].payload.args.should.eql([1, 2, 3])
      })

      it('can remove a failed job by payload', async () => {
        let failedJobs = queue.failed(1, 1)
        failedJobs.length.should.equal(1)
        let removedJobs = await queue.removeFailed(failedJobs[0])
        removedJobs.should.equal(1)
        let failedCountAgain = queue.failedCount()
        failedCountAgain.should.equal(2)
      })

      it('can re-enqueue a specific job, removing it from the failed queue', function (done) {
        queue.failed(0, 999, function (err, failedJobs) {
          should.not.exist(err)
          failedJobs.length.should.equal(3)
          failedJobs[2].worker.should.equal('busted-worker-3')
          queue.retryAndRemoveFailed(failedJobs[2], function (err, retriedJob) {
            should.not.exist(err)
            queue.failed(0, 999, function (err, failedJobs) {
              should.not.exist(err)
              failedJobs.length.should.equal(2)
              failedJobs[0].worker.should.equal('busted-worker-1')
              failedJobs[1].worker.should.equal('busted-worker-2')
              done()
            })
          })
        })
      })

      it('will return an error when trying to retry a job not in the failed queue', function (done) {
        queue.failed(0, 999, function (err, failedJobs) {
          should.not.exist(err)
          failedJobs.length.should.equal(3)
          var failedJob = failedJobs[2]
          failedJob.worker = 'a-fake-worker'
          queue.retryAndRemoveFailed(failedJob, function (err, retriedJob) {
            String(err).should.eql('Error: This job is not in failed queue')
            queue.failed(0, 999, function (err, failedJobs) {
              should.not.exist(err)
              failedJobs.length.should.equal(3)
              done()
            })
          })
        })
      })
    })

    describe('delayed status', function () {
      beforeEach(function (done) {
        queue.enqueueAt(10000, specHelper.queue, 'job1', [1, 2, 3], function () {
          queue.enqueueAt(10000, specHelper.queue, 'job2', [1, 2, 3], function () {
            queue.enqueueAt(20000, specHelper.queue, 'job3', [1, 2, 3], function () {
              done()
            })
          })
        })
      })

      it('can list the timestamps that exist', function (done) {
        queue.timestamps(function (err, timestamps) {
          should.not.exist(err)
          timestamps.length.should.equal(2)
          timestamps[0].should.equal(10000)
          timestamps[1].should.equal(20000)
          done()
        })
      })

      it('can list the jobs delayed at a timestamp', function (done) {
        queue.delayedAt(10000, function (err, tasksA) {
          should.not.exist(err)
          tasksA.length.should.equal(2)
          tasksA[0]['class'].should.equal('job1')
          tasksA[1]['class'].should.equal('job2')
          queue.delayedAt(20000, function (err, tasksB) {
            should.not.exist(err)
            tasksB.length.should.equal(1)
            tasksB[0]['class'].should.equal('job3')
            done()
          })
        })
      })

      it('can also return a hash with all delayed tasks', function (done) {
        queue.allDelayed(function (err, hash) {
          should.not.exist(err)
          Object.keys(hash).length.should.equal(2)
          Object.keys(hash)[0].should.equal('10000')
          Object.keys(hash)[1].should.equal('20000')
          hash['10000'].length.should.equal(2)
          hash['20000'].length.should.equal(1)
          done()
        })
      })
    })

    describe('worker status', function () {
      var workerA
      var workerB
      var timeout = 500

      var jobs = {
        'slowJob': {
          perform: function (callback) {
            setTimeout(function () {
              callback(null)
            }, timeout)
          }
        }
      }

      beforeEach(function (done) {
        var Worker = specHelper.NR.worker

        workerA = new Worker({
          connection: specHelper.connectionDetails,
          timeout: specHelper.timeout,
          queues: specHelper.queue,
          name: 'workerA'
        }, jobs)

        workerB = new Worker({
          connection: specHelper.connectionDetails,
          timeout: specHelper.timeout,
          queues: specHelper.queue,
          name: 'workerB'
        }, jobs)

        workerA.connect(function () {
          workerB.connect(function () {
            workerA.init(function () {
              workerB.init(function () {
                done()
              })
            })
          })
        })
      })

      afterEach(function (done) {
        workerA.end(function () {
          workerB.end(function () {
            done()
          })
        })
      })

      it('can list running workers', function (done) {
        queue.workers(function (err, workers) {
          should.not.exist(err)
          workers.workerA.should.equal('test_queue')
          workers.workerB.should.equal('test_queue')
          done()
        })
      })

      it('we can see what workers are working on (idle)', function (done) {
        queue.allWorkingOn(function (err, data) {
          should.not.exist(err)
          data.should.containEql({'workerA': 'started'})
          data.should.containEql({'workerB': 'started'})
          done()
        })
      })

      it('we can see what workers are working on (active)', function (done) {
        workerA.on('job', function (q, job, failure) {
          workerA.removeAllListeners('job')

          queue.allWorkingOn(function (err, data) {
            should.not.exist(err)
            data.should.containEql({'workerB': 'started'})
            var paylaod = data.workerA.payload
            paylaod.queue.should.equal('test_queue')
            paylaod['class'].should.equal('slowJob')

            done()
          })
        })

        queue.enqueue(specHelper.queue, 'slowJob')
        workerA.start()
      })

      it('can remove stuck workers', function (done) {
        var age = 1
        workerA.on('job', function (q, job, failure) {
          workerA.removeAllListeners('job')

          queue.allWorkingOn(function (err, data) {
            should.not.exist(err)
            var paylaod = data.workerA.payload
            paylaod.queue.should.equal('test_queue')
            paylaod['class'].should.equal('slowJob')

            queue.cleanOldWorkers(age, function (err, data) {
              should.not.exist(err)
              Object.keys(data).length.should.equal(1)
              data.workerA.queue.should.equal('test_queue')
              data.workerA.worker.should.equal('workerA')
              data.workerA.payload['class'].should.equal('slowJob')
              specHelper.redis.rpop(specHelper.namespace + ':' + 'failed', function (err, data) {
                should.not.exist(err)
                data = JSON.parse(data)
                data.queue.should.equal(specHelper.queue)
                data.exception.should.equal('Worker Timeout (killed manually)')
                data.error.should.equal('Worker Timeout (killed manually)')
                data.payload['class'].should.equal('slowJob')

                queue.allWorkingOn(function (err, data) {
                  should.not.exist(err)
                  Object.keys(data).length.should.equal(1)
                  data.workerB.should.equal('started')
                  done()
                })
              })
            })
          })
        })

        queue.enqueue(specHelper.queue, 'slowJob')
        workerA.start()
      })

      it('will not remove stuck jobs within the timelimit', function (done) {
        var age = 999
        workerA.on('job', function (q, job, failure) {
          workerA.removeAllListeners('job')

          queue.cleanOldWorkers(age, function (err, data) {
            should.not.exist(err)
            Object.keys(data).length.should.equal(0)
            queue.allWorkingOn(function (err, data) {
              should.not.exist(err)
              var paylaod = data.workerA.payload
              paylaod.queue.should.equal('test_queue')
              paylaod['class'].should.equal('slowJob')

              done()
            })
          })
        })

        queue.enqueue(specHelper.queue, 'slowJob')
        workerA.start()
      })
    })
  })
})
