const specHelper = require('../utils/specHelper.js')
const NodeResque = require('../../index.js')

let queue
let scheduler
let loggedErrors = []

const jobs = {
  'brokenJob': {
    plugins: ['Noop'],
    pluginOptions: { 'Noop': {
      logger: (error) => { loggedErrors.push(error) }
    } },
    perform: () => {
      throw new Error('BUSTED')
    }
  },
  'happyJob': {
    plugins: ['Noop'],
    pluginOptions: { 'Noop': {
      logger: (error) => { loggedErrors.push(error) }
    } },
    perform: function () {
      // nothing
    }
  }
}

describe('plugins', () => {
  describe('noop', () => {
    beforeAll(async () => {
      await specHelper.connect()
      await specHelper.cleanup()
      queue = new NodeResque.Queue({ connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue }, jobs)
      scheduler = new NodeResque.Scheduler({ connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout })
      await scheduler.connect()
      scheduler.start()
      await queue.connect()
    })

    beforeEach(() => { loggedErrors = [] })

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

      let worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, jobs)

      await new Promise(async (resolve) => {
        worker.on('success', async () => {
          expect(loggedErrors.length).toBe(0)
          let length = await specHelper.redis.llen('resque_test:failed')
          expect(length).toBe(0)
          await worker.end()
          resolve()
        })

        await worker.connect()
        worker.on('failure', () => { throw new Error('should never get here') })
        worker.start()
      })
    })

    test(
      'will prevent any failed jobs from ending in the failed queue',
      async () => {
        await queue.enqueue(specHelper.queue, 'brokenJob', [1, 2])
        let length = await queue.length(specHelper.queue)
        expect(length).toBe(1)

        let worker = new NodeResque.Worker({
          connection: specHelper.cleanConnectionDetails(),
          timeout: specHelper.timeout,
          queues: specHelper.queue
        }, jobs)

        await new Promise(async (resolve) => {
          worker.on('success', async () => {
            expect(loggedErrors.length).toBe(1)
            let length = await specHelper.redis.llen('resque_test:failed')
            expect(length).toBe(0)
            await worker.end()
            resolve()
          })

          await worker.connect()
          worker.on('failure', () => { throw new Error('should never get here') })
          worker.start()
        })
      }
    )
  })
})
