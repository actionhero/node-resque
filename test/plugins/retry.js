const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should') // eslint-disable-line
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

let queue
let scheduler

const jobs = {
  'brokenJob': {
    plugins: ['Retry'],
    pluginOptions: { Retry: {
      retryLimit: 3,
      retryDelay: 100
    } },
    perform: () => {
      throw new Error('BUSTED')
    }
  },
  'happyJob': {
    plugins: ['Retry'],
    pluginOptions: { Retry: {
      retryLimit: 3,
      retryDelay: 100
    } },
    perform: () => {
      // no return
    }
  }
}

describe('plugins', () => {
  describe('retry', () => {
    before(async () => {
      await specHelper.connect()
      await specHelper.cleanup()
      queue = new NodeResque.Queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs)
      scheduler = new NodeResque.Scheduler({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout})
      await scheduler.connect()
      scheduler.start()
      await queue.connect()
    })

    after(async () => { await scheduler.end() })
    afterEach(async () => { await specHelper.cleanup() })

    it('will work fine with non-crashing jobs', async () => {
      await queue.enqueue(specHelper.queue, 'happyJob', [1, 2])
      let length = await queue.length(specHelper.queue)
      length.should.equal(1)

      var worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, jobs)

      worker.on('failure', () => { throw new Error('should not get here') })

      await new Promise(async (resolve) => {
        await worker.connect()

        worker.on('success', async () => {
          let length = await specHelper.redis.llen('resque_test:failed')
          length.should.equal(0)
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })

    it('will retry the job n times before finally failing', async () => {
      await queue.enqueue(specHelper.queue, 'brokenJob')
      let length = await queue.length(specHelper.queue)
      length.should.equal(1)

      let failButRetryCount = 0
      let failureCount = 0

      let worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, jobs)

      worker.on('success', () => { failButRetryCount++ })

      await new Promise(async (resolve) => {
        await worker.connect()

        worker.on('failure', async () => {
          failureCount++
          failButRetryCount.should.equal(2)
          failureCount.should.equal(1);
          (failButRetryCount + failureCount).should.equal(3)

          let length = await specHelper.redis.llen('resque_test:failed')
          length.should.equal(1)
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })

    it('can have a retry count set', async () => {
      const customJobs = {
        'jobWithRetryCount': {
          plugins: ['Retry'],
          pluginOptions: { Retry: {
            retryLimit: 5,
            retryDelay: 100
          } },
          perform: () => {
            throw new Error('BUSTED')
          }
        }
      }

      await queue.enqueue(specHelper.queue, 'jobWithRetryCount', [1, 2])
      let length = await queue.length(specHelper.queue)
      length.should.equal(1)

      let failButRetryCount = 0
      let failureCount = 0

      let worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, customJobs)

      worker.on('success', () => { failButRetryCount++ })

      await new Promise(async (resolve) => {
        await worker.connect()

        worker.on('failure', async () => {
          failureCount++
          failButRetryCount.should.equal(4)
          failureCount.should.equal(1);
          (failButRetryCount + failureCount).should.equal(5)

          let length = await specHelper.redis.llen('resque_test:failed')
          length.should.equal(1)
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })

    it('can have custom retry times set', async () => {
      const customJobs = {
        'jobWithBackoffStrategy': {
          plugins: ['Retry'],
          pluginOptions: { Retry: {
            retryLimit: 5,
            backoffStrategy: [1, 2, 3, 4, 5]
          } },
          perform: function (a, b, callback) {
            callback(new Error('BUSTED'), null)
          }
        }
      }

      await queue.enqueue(specHelper.queue, 'jobWithBackoffStrategy', [1, 2])
      let length = await queue.length(specHelper.queue)
      length.should.equal(1)

      let failButRetryCount = 0
      let failureCount = 0

      let worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, customJobs)

      worker.on('success', () => { failButRetryCount++ })

      await new Promise(async (resolve) => {
        await worker.connect()

        worker.on('failure', async () => {
          failureCount++
          failButRetryCount.should.equal(4)
          failureCount.should.equal(1);
          (failButRetryCount + failureCount).should.equal(5)

          let length = await specHelper.redis.llen('resque_test:failed')
          length.should.equal(1)
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })

    it('when a job fails it should be re-enqueued (and not go to the failure queue)', async () => {
      await queue.enqueue(specHelper.queue, 'brokenJob', [1, 2])

      let worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, jobs)

      await new Promise(async (resolve) => {
        await worker.connect()
        worker.on('success', async () => {
          let timestamps = await queue.scheduledAt(specHelper.queue, 'brokenJob', [1, 2])
          timestamps.length.should.be.equal(1)
          let length = await specHelper.redis.llen('resque_test:failed')
          length.should.equal(0)
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })

    it('will handle the stats properly for failing jobs', async () => {
      await queue.enqueue(specHelper.queue, 'brokenJob', [1, 2])

      let worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, jobs)

      await new Promise(async (resolve) => {
        await worker.connect()
        worker.on('success', async () => {
          let globalProcessed = await specHelper.redis.get('resque_test:stat:processed')
          let globalFailed = await specHelper.redis.get('resque_test:stat:failed')
          let workerProcessed = await specHelper.redis.get('resque_test:stat:processed:' + worker.name)
          let workerFailed = await specHelper.redis.get('resque_test:stat:failed:' + worker.name)
          String(globalProcessed).should.equal('0')
          String(globalFailed).should.equal('1')
          String(workerProcessed).should.equal('0')
          String(workerFailed).should.equal('1')
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })

    it('will set the retry counter & retry data', async () => {
      await queue.enqueue(specHelper.queue, 'brokenJob', [1, 2])

      let worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, jobs)

      await new Promise(async (resolve) => {
        await worker.connect()
        worker.on('success', async () => {
          let retryAttempts = await specHelper.redis.get('resque_test:resque-retry:brokenJob:1-2')
          let failureData = await specHelper.redis.get('resque_test:failure-resque-retry:brokenJob:1-2')
          String(retryAttempts).should.equal('0')
          failureData = JSON.parse(failureData)
          failureData.payload.should.deepEqual([1, 2])
          failureData.exception.should.equal('Error: BUSTED')
          failureData.worker.should.equal('brokenJob')
          failureData.queue.should.equal('test_queue')
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })
  })
})
