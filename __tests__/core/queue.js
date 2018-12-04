const specHelper = require('../utils/specHelper.js')
const NodeResque = require('../../index.js')
let queue

describe('queue', () => {
  afterAll(async () => { await specHelper.disconnect() })

  test('can connect', async () => {
    queue = new NodeResque.Queue({ connection: specHelper.connectionDetails, queue: specHelper.queue })
    await queue.connect()
    await queue.end()
  })

  test('can provide an error if connection failed', async () => {
    let connectionDetails = {
      pkg: specHelper.connectionDetails.pkg,
      host: 'wronghostname',
      password: specHelper.connectionDetails.password,
      port: specHelper.connectionDetails.port,
      database: specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace
    }

    queue = new NodeResque.Queue({ connection: connectionDetails, queue: specHelper.queue })

    await new Promise((resolve) => {
      queue.connect()

      queue.on('error', (error) => {
        expect(error.message).toMatch(/getaddrinfo ENOTFOUND/)
        queue.end()
        resolve()
      })
    })
  })

  describe('[with connection]', () => {
    beforeAll(async () => {
      await specHelper.connect()
      queue = new NodeResque.Queue({ connection: specHelper.connectionDetails, queue: specHelper.queue })
      await queue.connect()
    })

    beforeEach(async () => { await specHelper.cleanup() })
    afterAll(async () => { await specHelper.cleanup() })

    test('can add a normal job', async () => {
      await queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3])
      let obj = await specHelper.popFromQueue()
      expect(obj).toBeDefined()
      obj = JSON.parse(obj)
      expect(obj['class']).toBe('someJob')
      expect(obj.args).toEqual([1, 2, 3])
    })

    test('can add delayed job (enqueueAt)', async () => {
      await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
      let score = await specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', '10')
      expect(String(score)).toBe('10')

      let obj = await specHelper.redis.lpop(specHelper.namespace + ':delayed:' + '10')
      expect(obj).toBeDefined()
      obj = JSON.parse(obj)
      expect(obj['class']).toBe('someJob')
      expect(obj.args).toEqual([1, 2, 3])
    })

    test(
      'can add delayed job whose timestamp is a string (enqueueAt)',
      async () => {
        await queue.enqueueAt('10000', specHelper.queue, 'someJob', [1, 2, 3])
        let score = await specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', '10')
        expect(String(score)).toBe('10')

        let obj = await specHelper.redis.lpop(specHelper.namespace + ':delayed:' + '10')
        expect(obj).toBeDefined()
        obj = JSON.parse(obj)
        expect(obj['class']).toBe('someJob')
        expect(obj.args).toEqual([1, 2, 3])
      }
    )

    test(
      'will not enqueue a delayed job at the same time with matching params',
      async () => {
        await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
        try {
          await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
          throw new Error('should not get here')
        } catch (error) {
          expect(String(error)).toBe('Error: Job already enqueued at this time with same arguments')
        }
      }
    )

    test('can add delayed job (enqueueIn)', async () => {
      let now = Math.round(new Date().getTime() / 1000) + 5
      await queue.enqueueIn(5 * 1000, specHelper.queue, 'someJob', [1, 2, 3])
      let score = await specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', now)
      expect(String(score)).toBe(String(now))

      let obj = await specHelper.redis.lpop(specHelper.namespace + ':delayed:' + now)
      expect(obj).toBeDefined()
      obj = JSON.parse(obj)
      expect(obj['class']).toBe('someJob')
      expect(obj.args).toEqual([1, 2, 3])
    })

    test('can add a delayed job whose time is a string (enqueueIn)', async () => {
      let now = Math.round(new Date().getTime() / 1000) + 5
      let time = 5 * 1000

      await queue.enqueueIn(time.toString(), specHelper.queue, 'someJob', [1, 2, 3])
      let score = await specHelper.redis.zscore(specHelper.namespace + ':delayed_queue_schedule', now)
      expect(String(score)).toBe(String(now))

      let obj = await specHelper.redis.lpop(specHelper.namespace + ':delayed:' + now)
      expect(obj).toBeDefined()
      obj = JSON.parse(obj)
      expect(obj['class']).toBe('someJob')
      expect(obj.args).toEqual([1, 2, 3])
    })

    test('can get the number of jobs currently enqueued', async () => {
      await queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3])
      await queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3])
      let length = await queue.length(specHelper.queue)
      expect(length).toBe(2)
    })

    test('can get the jobs in the queue', async () => {
      await queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3])
      await queue.enqueue(specHelper.queue, 'someJob', [4, 5, 6])
      let jobs = await queue.queued(specHelper.queue, 0, -1)
      expect(jobs.length).toBe(2)
      expect(jobs[0].args).toEqual([1, 2, 3])
      expect(jobs[1].args).toEqual([4, 5, 6])
    })

    test('can find previously scheduled jobs', async () => {
      await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
      let timestamps = await queue.scheduledAt(specHelper.queue, 'someJob', [1, 2, 3])
      expect(timestamps.length).toBe(1)
      expect(timestamps[0]).toBe('10')
    })

    test(
      'will not match previously scheduled jobs with differnt args',
      async () => {
        await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
        let timestamps = await queue.scheduledAt(specHelper.queue, 'someJob', [3, 2, 1])
        expect(timestamps.length).toBe(0)
      }
    )

    test('can deleted an enqued job', async () => {
      await queue.enqueue(specHelper.queue, 'someJob', [1, 2, 3])
      let length = await queue.length(specHelper.queue)
      expect(length).toBe(1)

      await queue.del(specHelper.queue, 'someJob', [1, 2, 3])
      let lengthAgain = await queue.length(specHelper.queue)
      expect(lengthAgain).toBe(0)
    })

    test('can deleted a delayed job', async () => {
      await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
      let timestamps = await queue.delDelayed(specHelper.queue, 'someJob', [1, 2, 3])
      expect(timestamps.length).toBe(1)
      expect(timestamps[0]).toBe('10')
    })

    test(
      'can delete a delayed job, and delayed queue should be empty',
      async () => {
        await queue.enqueueAt(10000, specHelper.queue, 'someJob', [1, 2, 3])
        let timestamps = await queue.delDelayed(specHelper.queue, 'someJob', [1, 2, 3])
        let hash = await queue.allDelayed()
        expect(Object.keys(hash)).toHaveLength(0)
        expect(timestamps.length).toBe(1)
        expect(timestamps[0]).toBe('10')
      }
    )

    test('can handle single arguments without explicit array', async () => {
      await queue.enqueue(specHelper.queue, 'someJob', 1)
      let obj = await specHelper.popFromQueue()
      expect(JSON.parse(obj).args).toEqual([1])
    })

    test('allows omitting arguments when enqueuing', async () => {
      await queue.enqueue(specHelper.queue, 'noParams')
      let length = await queue.length(specHelper.queue)
      expect(length).toBe(1)
      let obj = await specHelper.popFromQueue()
      obj = JSON.parse(obj)
      expect(obj['class']).toBe('noParams')
      expect(Array.isArray(obj.args)).toBe(true)
      expect(obj.args).toHaveLength(0)
    })

    test('allows omitting arguments when deleting', async () => {
      await queue.enqueue(specHelper.queue, 'noParams', [])
      await queue.enqueue(specHelper.queue, 'noParams', [])
      let length = await queue.length(specHelper.queue)
      expect(length).toBe(2)

      let deletedCount = await queue.del(specHelper.queue, 'noParams')
      expect(deletedCount).toBe(2)

      let deletedCountAgain = await queue.del(specHelper.queue, 'noParams')
      expect(deletedCountAgain).toBe(0)
      let lengthAgain = await queue.length(specHelper.queue)
      expect(lengthAgain).toBe(0)
    })

    test('allows omitting arguments when adding delayed job', async () => {
      let hash = await queue.allDelayed()
      expect(Object.keys(hash)).toHaveLength(0)

      await queue.enqueueAt(10000, specHelper.queue, 'noParams', [])
      await queue.enqueueIn(11000, specHelper.queue, 'noParams', [])
      await queue.enqueueAt(12000, specHelper.queue, 'noParams', [])
      await queue.enqueueIn(13000, specHelper.queue, 'noParams', [])

      let timestamps = await queue.scheduledAt(specHelper.queue, 'noParams', [])
      expect(timestamps.length).toBe(4)
      let hashAgain = await queue.allDelayed()
      expect(Object.keys(hashAgain).length).toBe(4)
      for (let key in hashAgain) {
        expect(hashAgain[key][0].args).toHaveLength(0)
        expect(Array.isArray(hashAgain[key][0].args)).toBe(true)
      }
    })

    test('allows omitting arguments when deleting a delayed job', async () => {
      let hash = await queue.allDelayed()
      expect(Object.keys(hash)).toHaveLength(0)

      await queue.enqueueAt(10000, specHelper.queue, 'noParams')
      await queue.enqueueAt(12000, specHelper.queue, 'noParams')

      let hashAgain = await queue.allDelayed()
      expect(Object.keys(hashAgain).length).toBe(2)

      await queue.delDelayed(specHelper.queue, 'noParams')
      await queue.delDelayed(specHelper.queue, 'noParams')
      let hashThree = queue.allDelayed()
      expect(Object.keys(hashThree)).toHaveLength(0)
    })

    test('can load stats', async () => {
      await queue.connection.redis.set(specHelper.namespace + ':stat:failed', 1)
      await queue.connection.redis.set(specHelper.namespace + ':stat:processed', 2)

      let stats = await queue.stats()
      expect(stats.processed).toBe('2')
      expect(stats.failed).toBe('1')
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

      test('can get locks', async () => {
        let locks = await queue.locks()
        expect(Object.keys(locks).length).toBe(2)
        expect(locks['lock:lists:queueName:jobName:[{}]']).toBe('123')
        expect(locks['workerslock:lists:queueName:jobName:[{}]']).toBe('456')
      })

      test('can remove locks', async () => {
        let locks = await queue.locks()
        expect(Object.keys(locks).length).toBe(2)
        let count = await queue.delLock('workerslock:lists:queueName:jobName:[{}]')
        expect(count).toBe(1)
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

      test('can list how many failed jobs there are', async () => {
        let failedCount = await queue.failedCount()
        expect(failedCount).toBe(3)
      })

      test('can get the body content for a collection of failed jobs', async () => {
        let failedJobs = await queue.failed(1, 2)
        expect(failedJobs.length).toBe(2)

        expect(failedJobs[0].worker).toBe('busted-worker-2')
        expect(failedJobs[0].queue).toBe('busted-queue')
        expect(failedJobs[0].exception).toBe('ERROR_NAME')
        expect(failedJobs[0].error).toBe('I broke')
        expect(failedJobs[0].payload.args).toEqual([1, 2, 3])

        expect(failedJobs[1].worker).toBe('busted-worker-3')
        expect(failedJobs[1].queue).toBe('busted-queue')
        expect(failedJobs[1].exception).toBe('ERROR_NAME')
        expect(failedJobs[1].error).toBe('I broke')
        expect(failedJobs[1].payload.args).toEqual([1, 2, 3])
      })

      test('can remove a failed job by payload', async () => {
        let failedJobs = await queue.failed(1, 1)
        expect(failedJobs.length).toBe(1)
        let removedJobs = await queue.removeFailed(failedJobs[0])
        expect(removedJobs).toBe(1)
        let failedCountAgain = await queue.failedCount()
        expect(failedCountAgain).toBe(2)
      })

      test(
        'can re-enqueue a specific job, removing it from the failed queue',
        async () => {
          let failedJobs = await queue.failed(0, 999)
          expect(failedJobs.length).toBe(3)
          expect(failedJobs[2].worker).toBe('busted-worker-3')

          await queue.retryAndRemoveFailed(failedJobs[2])
          let failedJobsAgain = await queue.failed(0, 999)
          expect(failedJobsAgain.length).toBe(2)
          expect(failedJobsAgain[0].worker).toBe('busted-worker-1')
          expect(failedJobsAgain[1].worker).toBe('busted-worker-2')
        }
      )

      test(
        'will return an error when trying to retry a job not in the failed queue',
        async () => {
          let failedJobs = await queue.failed(0, 999)
          expect(failedJobs.length).toBe(3)

          let failedJob = failedJobs[2]
          failedJob.worker = 'a-fake-worker'
          try {
            await queue.retryAndRemoveFailed(failedJob)
            throw new Error('should not get here')
          } catch (error) {
            expect(String(error)).toBe('Error: This job is not in failed queue')
            let failedJobsAgain = await queue.failed(0, 999)
            expect(failedJobsAgain.length).toBe(3)
          }
        }
      )
    })

    describe('delayed status', () => {
      beforeEach(async () => {
        await queue.enqueueAt(10000, specHelper.queue, 'job1', [1, 2, 3])
        await queue.enqueueAt(10000, specHelper.queue, 'job2', [1, 2, 3])
        await queue.enqueueAt(20000, specHelper.queue, 'job3', [1, 2, 3])
      })

      test('can list the timestamps that exist', async () => {
        let timestamps = await queue.timestamps()
        expect(timestamps.length).toBe(2)
        expect(timestamps[0]).toBe(10000)
        expect(timestamps[1]).toBe(20000)
      })

      test('can list the jobs delayed at a timestamp', async () => {
        let tasksA = await queue.delayedAt(10000)
        expect(tasksA.rTimestamp).toBe(10)
        expect(tasksA.tasks.length).toBe(2)
        expect(tasksA.tasks[0]['class']).toBe('job1')
        expect(tasksA.tasks[1]['class']).toBe('job2')

        let tasksB = await queue.delayedAt(20000)
        expect(tasksB.rTimestamp).toBe(20)
        expect(tasksB.tasks.length).toBe(1)
        expect(tasksB.tasks[0]['class']).toBe('job3')
      })

      test('can also return a hash with all delayed tasks', async () => {
        let hash = await queue.allDelayed()
        expect(Object.keys(hash).length).toBe(2)
        expect(Object.keys(hash)[0]).toBe('10000')
        expect(Object.keys(hash)[1]).toBe('20000')
        expect(hash['10000'].length).toBe(2)
        expect(hash['20000'].length).toBe(1)
      })
    })

    describe('worker status', () => {
      let workerA
      let workerB
      let timeout = 500

      let jobs = {
        'slowJob': {
          perform: async () => {
            await new Promise((resolve) => { setTimeout(resolve, timeout) })
          }
        }
      }

      beforeEach(async () => {
        workerA = new NodeResque.Worker({
          connection: specHelper.connectionDetails,
          timeout: specHelper.timeout,
          queues: specHelper.queue,
          name: 'workerA'
        }, jobs)

        workerB = new NodeResque.Worker({
          connection: specHelper.connectionDetails,
          timeout: specHelper.timeout,
          queues: specHelper.queue,
          name: 'workerB'
        }, jobs)

        await workerA.connect()
        await workerA.init()
        await workerB.connect()
        await workerB.init()
      })

      afterEach(async () => {
        await workerA.end()
        await workerB.end()
      })

      test('can list running workers', async () => {
        let workers = await queue.workers()
        expect(workers.workerA).toBe('test_queue')
        expect(workers.workerB).toBe('test_queue')
      })

      test('we can see what workers are working on (idle)', async () => {
        let data = await queue.allWorkingOn()
        expect(data).toHaveProperty('workerA', 'started')
        expect(data).toHaveProperty('workerB', 'started')
      })

      test('we can see what workers are working on (active)', async () => {
        queue.enqueue(specHelper.queue, 'slowJob')
        workerA.start()

        await new Promise((resolve) => {
          workerA.on('job', async () => {
            workerA.removeAllListeners('job')

            let data = await queue.allWorkingOn()
            expect(data).toHaveProperty('workerB', 'started')
            let paylaod = data.workerA.payload
            expect(paylaod.queue).toBe('test_queue')
            expect(paylaod['class']).toBe('slowJob')

            return resolve()
          })
        })
      })

      test('can remove stuck workers and re-enqueue their jobs', async () => {
        let age = 1
        await queue.enqueue(specHelper.queue, 'slowJob', { a: 1 })
        await workerA.start()

        await new Promise((resolve) => {
          // hijack a worker in the middle of working on a job
          workerA.on('job', async () => {
            workerA.removeAllListeners('job')

            let workingOnData = await queue.allWorkingOn()
            let paylaod = workingOnData.workerA.payload
            expect(paylaod.queue).toBe('test_queue')
            expect(paylaod['class']).toBe('slowJob')
            expect(paylaod.args[0].a).toBe(1)

            let runAt = Date.parse(workingOnData.workerA.run_at)
            let now = (new Date()).getTime()
            expect(runAt).toBeGreaterThanOrEqual(now - 1001)
            expect(runAt).toBeLessThanOrEqual(now)

            let cleanData = await queue.cleanOldWorkers(age)
            expect(Object.keys(cleanData).length).toBe(1)
            expect(cleanData.workerA.queue).toBe('test_queue')
            expect(cleanData.workerA.worker).toBe('workerA')
            expect(cleanData.workerA.payload['class']).toBe('slowJob')
            expect(cleanData.workerA.payload.args[0].a).toBe(1)

            let failedData = await specHelper.redis.rpop(specHelper.namespace + ':' + 'failed')
            failedData = JSON.parse(failedData)
            expect(failedData.queue).toBe(specHelper.queue)
            expect(failedData.exception).toBe('Worker Timeout (killed manually)')
            expect(failedData.error).toBe('Worker Timeout (killed manually)')
            expect(failedData.payload['class']).toBe('slowJob')
            expect(failedData.payload.args[0].a).toBe(1)

            let workingOnDataAgain = await queue.allWorkingOn()
            expect(Object.keys(workingOnDataAgain).length).toBe(1)
            expect(workingOnDataAgain.workerB).toBe('started')

            return resolve()
          })
        })
      })

      test('will not remove stuck jobs within the time limit', async () => {
        var age = 999
        queue.enqueue(specHelper.queue, 'slowJob')
        workerA.start()

        await new Promise((resolve) => {
          workerA.on('job', async () => {
            workerA.removeAllListeners('job')

            let data = await queue.cleanOldWorkers(age)
            expect(Object.keys(data).length).toBe(0)

            let workingOn = await queue.allWorkingOn()
            var paylaod = workingOn.workerA.payload
            expect(paylaod.queue).toBe('test_queue')
            expect(paylaod['class']).toBe('slowJob')

            return resolve()
          })
        })
      })
    })
  })
})
