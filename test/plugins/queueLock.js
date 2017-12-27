const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should') // eslint-disable-line
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

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
    before(async () => {
      await specHelper.connect()
      await specHelper.cleanup()
      queue = new NodeResque.Queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs)
      await queue.connect()
    })

    afterEach(async () => { await specHelper.cleanup() })
    beforeEach(async () => { await specHelper.cleanup() })

    it('will not enque a job with the same args if it is already in the queue', async () => {
      let tryOne = await queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2])
      let tryTwo = await queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2])
      let length = await queue.length(specHelper.queue)
      length.should.equal(1)
      tryOne.should.equal(true)
      tryTwo.should.equal(false)
    })

    it('will enque a job with the different args', async () => {
      let tryOne = await queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2])
      let tryTwo = await queue.enqueue(specHelper.queue, 'uniqueJob', [3, 4])
      let length = await queue.length(specHelper.queue)
      length.should.equal(2)
      tryOne.should.equal(true)
      tryTwo.should.equal(true)
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

      it('will remove a lock on a job when the job has been worked', async () => {
        const enqueue = await queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2])
        enqueue.should.equal(true)

        await worker.start()
        await worker.end()

        const result = await specHelper.redis.keys(specHelper.namespace + ':lock*')
        result.should.have.lengthOf(0)
      })

      it('will remove a lock on a job if a plugin does not run the job', async () => {
        const enqueue = await queue.enqueue(specHelper.queue, 'blockingJob', [1, 2])
        enqueue.should.equal(true)

        await worker.start()
        await worker.end()

        const result = await specHelper.redis.keys(specHelper.namespace + ':lock*')
        result.should.have.lengthOf(0)
      })
    })
  })
})
