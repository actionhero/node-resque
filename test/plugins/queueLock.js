const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should') // eslint-disable-line
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

let queue

const jobs = {
  'uniqueJob': {
    plugins: ['QueueLock', 'DelayQueueLock'],
    pluginOptions: { queueLock: {}, delayQueueLock: {} },
    perform: (a, b) => {
      return (a + b)
    }
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
  })
})
