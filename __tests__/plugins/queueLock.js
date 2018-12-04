const specHelper = require('../utils/specHelper.js')
const NodeResque = require('../../index.js')

let queue

class NeverRunPlugin extends NodeResque.Plugin {
  beforePerform () { return false }
}

const jobs = {
  'uniqueJob': {
    plugins: ['QueueLock'],
    pluginOptions: { queueLock: {}, delayQueueLock: {} },
    perform: (a, b) => (a + b)
  },
  'blockingJob': {
    plugins: ['QueueLock', NeverRunPlugin],
    perform: (a, b) => (a + b)
  }
}

describe('plugins', () => {
  describe('queueLock', () => {
    beforeAll(async () => {
      await specHelper.connect()
      await specHelper.cleanup()
      queue = new NodeResque.Queue({ connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue }, jobs)
      await queue.connect()
    })

    beforeEach(async () => { await specHelper.cleanup() })
    afterEach(async () => { await specHelper.cleanup() })

    afterAll(async () => {
      await queue.end()
      await specHelper.disconnect()
    })

    test(
      'will not enque a job with the same args if it is already in the queue',
      async () => {
        let tryOne = await queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2])
        let tryTwo = await queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2])
        let length = await queue.length(specHelper.queue)
        expect(length).toBe(1)
        expect(tryOne).toBe(true)
        expect(tryTwo).toBe(false)
      }
    )

    test('will enque a job with the different args', async () => {
      let tryOne = await queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2])
      let tryTwo = await queue.enqueue(specHelper.queue, 'uniqueJob', [3, 4])
      let length = await queue.length(specHelper.queue)
      expect(length).toBe(2)
      expect(tryOne).toBe(true)
      expect(tryTwo).toBe(true)
    })

    describe('with worker', () => {
      let worker

      beforeEach(async () => {
        worker = new NodeResque.Worker({
          connection: specHelper.cleanConnectionDetails(),
          timeout: specHelper.timeout,
          queues: specHelper.queue
        }, jobs)

        worker.on('error', (error) => { throw error })
        await worker.connect()
      })

      test('will remove a lock on a job when the job has been worked', async () => {
        const enqueue = await queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2])
        expect(enqueue).toBe(true)

        await worker.start()
        await worker.end()

        const result = await specHelper.redis.keys(specHelper.namespace + ':lock*')
        expect(result).toHaveLength(0)
      })

      test(
        'will remove a lock on a job if a plugin does not run the job',
        async () => {
          const enqueue = await queue.enqueue(specHelper.queue, 'blockingJob', [1, 2])
          expect(enqueue).toBe(true)

          await worker.start()
          await worker.end()

          const result = await specHelper.redis.keys(specHelper.namespace + ':lock*')
          expect(result).toHaveLength(0)
        }
      )
    })
  })
})
