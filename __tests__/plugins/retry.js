const specHelper = require('../utils/specHelper.js')
const NodeResque = require('../../index.js')

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
    beforeAll(async () => {
      await specHelper.connect()
      await specHelper.cleanup()
      queue = new NodeResque.Queue({ connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue }, jobs)
      scheduler = new NodeResque.Scheduler({ connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout })
      await scheduler.connect()
      scheduler.start()
      await queue.connect()
    })

    afterAll(async () => {
      await scheduler.end()
      await queue.end()
      await specHelper.disconnect()
    })

    afterEach(async () => { await specHelper.cleanup() })

    test('will work fine with non-crashing jobs', async () => {
      await queue.enqueue(specHelper.queue, 'happyJob', [1, 2])
      let length = await queue.length(specHelper.queue)
      expect(length).toBe(1)

      var worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, jobs)

      worker.on('failure', () => { throw new Error('should not get here') })

      await new Promise(async (resolve) => {
        await worker.connect()

        worker.on('success', async () => {
          let length = await specHelper.redis.llen(`${specHelper.namespace}:failed`)
          expect(length).toBe(0)
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })

    test('will retry the job n times before finally failing', async () => {
      await queue.enqueue(specHelper.queue, 'brokenJob')
      let length = await queue.length(specHelper.queue)
      expect(length).toBe(1)

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
          expect(failButRetryCount).toBe(2)
          expect(failureCount).toBe(1)
          expect(failButRetryCount + failureCount).toBe(3)

          let length = await specHelper.redis.llen(`${specHelper.namespace}:failed`)
          expect(length).toBe(1)
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })

    test('can have a retry count set', async () => {
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
      expect(length).toBe(1)

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
          expect(failButRetryCount).toBe(4)
          expect(failureCount).toBe(1)
          expect(failButRetryCount + failureCount).toBe(5)

          let length = await specHelper.redis.llen(`${specHelper.namespace}:failed`)
          expect(length).toBe(1)
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })

    test('can have custom retry times set', async () => {
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
      expect(length).toBe(1)

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
          expect(failButRetryCount).toBe(4)
          expect(failureCount).toBe(1)
          expect(failButRetryCount + failureCount).toBe(5)

          let length = await specHelper.redis.llen(`${specHelper.namespace}:failed`)
          expect(length).toBe(1)
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })

    test(
      'when a job fails it should be re-enqueued (and not go to the failure queue)',
      async () => {
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
            expect(timestamps.length).toBe(1)
            let length = await specHelper.redis.llen(`${specHelper.namespace}:failed`)
            expect(length).toBe(0)
            await worker.end()
            resolve()
          })

          worker.start()
        })
      }
    )

    test('will handle the stats properly for failing jobs', async () => {
      await queue.enqueue(specHelper.queue, 'brokenJob', [1, 2])

      let worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, jobs)

      await new Promise(async (resolve) => {
        await worker.connect()
        worker.on('success', async () => {
          let globalProcessed = await specHelper.redis.get(`${specHelper.namespace}:stat:processed`)
          let globalFailed = await specHelper.redis.get(`${specHelper.namespace}:stat:failed`)
          let workerProcessed = await specHelper.redis.get(`${specHelper.namespace}:stat:processed:${worker.name}`)
          let workerFailed = await specHelper.redis.get(`${specHelper.namespace}:stat:failed:${worker.name}`)
          expect(String(globalProcessed)).toBe('0')
          expect(String(globalFailed)).toBe('1')
          expect(String(workerProcessed)).toBe('0')
          expect(String(workerFailed)).toBe('1')
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })

    test('will set the retry counter & retry data', async () => {
      await queue.enqueue(specHelper.queue, 'brokenJob', [1, 2])

      let worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, jobs)

      await new Promise(async (resolve) => {
        await worker.connect()
        worker.on('success', async () => {
          let retryAttempts = await specHelper.redis.get(`${specHelper.namespace}:resque-retry:brokenJob:1-2`)
          let failureData = await specHelper.redis.get(`${specHelper.namespace}:failure-resque-retry:brokenJob:1-2`)
          expect(String(retryAttempts)).toBe('0')
          failureData = JSON.parse(failureData)
          expect(failureData.payload).toEqual([1, 2])
          expect(failureData.exception).toBe('Error: BUSTED')
          expect(failureData.worker).toBe('brokenJob')
          expect(failureData.queue).toBe('test_queue')
          await worker.end()
          resolve()
        })

        worker.start()
      })
    })
  })
})
