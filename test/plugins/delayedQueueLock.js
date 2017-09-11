const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should') // eslint-disable-line
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

let queue
let jobDelay = 100

const jobs = {
  'slowAdd': {
    plugins: ['JobLock'],
    pluginOptions: { jobLock: {} },
    perform: async (a, b) => {
      let answer = a + b
      await new Promise((resolve) => { setTimeout(resolve, jobDelay) })
      return answer
    }
  },
  'uniqueJob': {
    plugins: ['QueueLock', 'DelayQueueLock'],
    pluginOptions: { queueLock: {}, delayQueueLock: {} },
    perform: async (a, b) => {
      let answer = a + b
      return answer
    }
  }
}

describe('plugins', () => {
  before(async () => {
    await specHelper.connect()
    await specHelper.cleanup()
    queue = new NodeResque.Queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs)
    queue.connect()
  })

  after(async () => {
    await queue.end()
    await specHelper.cleanup()
  })

  beforeEach(async () => {
    await specHelper.cleanup()
  })

  describe('delayQueueLock', () => {
    it('will not enque a job with the same args if it is already in the delayed queue', async () => {
      await queue.enqueueIn((10 * 1000), specHelper.queue, 'uniqueJob', [1, 2])
      await queue.enqueue(specHelper.queue, 'uniqueJob', [1, 2])
      let delayedLen = await specHelper.redis.zcount(specHelper.namespace + ':delayed_queue_schedule', '-inf', '+inf')
      let queueLen = await queue.length(specHelper.queue)
      delayedLen.should.equal(1)
      queueLen.should.equal(0)
    })

    it('will enque a job with the different args', async () => {
      await queue.enqueueIn((10 * 1000), specHelper.queue, 'uniqueJob', [1, 2])
      await queue.enqueue(specHelper.queue, 'uniqueJob', [3, 4])
      let delayedLen = await specHelper.redis.zcount(specHelper.namespace + ':delayed_queue_schedule', '-inf', '+inf')
      let queueLen = await queue.length(specHelper.queue)
      delayedLen.should.equal(1)
      queueLen.should.equal(1)
    })
  })
})
