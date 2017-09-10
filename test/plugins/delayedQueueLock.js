const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should') // eslint-disable-line

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
    queue = new specHelper.NR.Queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs)
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

    it('will enque a job with the different args', function (done) {
      queue.enqueueIn((10 * 1000), specHelper.queue, 'uniqueJob', [1, 2], function () {
        queue.enqueue(specHelper.queue, 'uniqueJob', [3, 4], function () {
          specHelper.redis.zcount(specHelper.namespace + ':delayed_queue_schedule', '-inf', '+inf', function (err, delayedLen) {
            should.not.exist(err)
            queue.length(specHelper.queue, function (err, queueLen) {
              should.not.exist(err)
              delayedLen.should.equal(1)
              queueLen.should.equal(1)
              done()
            })
          })
        })
      })
    })
  })
})
