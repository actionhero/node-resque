const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should') // eslint-disable-line
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

let queue
let scheduler
let loggedErrors = []

const jobs = {
  'brokenJob': {
    plugins: ['Noop'],
    pluginOptions: {'Noop': {
      logger: (error) => { loggedErrors.push(error) }
    }},
    perform: () => {
      throw new Error('BUSTED')
    }
  },
  'happyJob': {
    plugins: ['Noop'],
    pluginOptions: {'Noop': {
      logger: (error) => { loggedErrors.push(error) }
    }},
    perform: function () {
      // nothing
    }
  }
}

describe('plugins', () => {
  describe('noop', () => {
    before(async () => {
      await specHelper.connect()
      await specHelper.cleanup()
      queue = new NodeResque.Queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs)
      scheduler = new NodeResque.Scheduler({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout})
      await scheduler.connect()
      scheduler.start()
      await queue.connect()
    })

    beforeEach(() => { loggedErrors = [] })
    after(async () => { await scheduler.end() })
    afterEach(async () => { await specHelper.cleanup() })

    it('will work fine with non-crashing jobs', async () => {
      await queue.enqueue(specHelper.queue, 'happyJob', [1, 2])
      let length = await queue.length(specHelper.queue)
      length.should.equal(1)

      let worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, jobs)

      await new Promise(async (resolve) => {
        await worker.connect()

        worker.on('success', async () => {
          loggedErrors.length.should.equal(0)
          let length = await specHelper.redis.llen('resque_test:failed')
          length.should.equal(0)
          await worker.end()
          resolve()
        })

        await worker.connect()
        worker.on('failure', () => { throw new Error('should never get here') })
        worker.start()
      })
    })

    it('will prevent any failed jobs from ending in the failed queue', async () => {
      await queue.enqueue(specHelper.queue, 'brokenJob', [1, 2])
      let length = await queue.length(specHelper.queue)
      length.should.equal(1)

      let worker = new NodeResque.Worker({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
        queues: specHelper.queue
      }, jobs)

      await new Promise(async (resolve) => {
        worker.on('success', async () => {
          loggedErrors.length.should.equal(1)
          let length = await specHelper.redis.llen('resque_test:failed')
          length.should.equal(0)
          await worker.end()
          resolve()
        })

        await worker.connect()
        worker.on('failure', () => { throw new Error('should never get here') })
        worker.start()
      })
    })
  })
})
