const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should') // eslint-disable-line
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

let queue
let multiWorker
let checkTimeout = specHelper.timeout / 10
let minTaskProcessors = 1
let maxTaskProcessors = 5

let toDisconnectProcessors = false

const blockingSleep = function (naptime) {
  let sleeping = true
  let now = new Date()
  let alarm
  let startingMSeconds = now.getTime()
  while (sleeping) {
    alarm = new Date()
    let alarmMSeconds = alarm.getTime()
    if (alarmMSeconds - startingMSeconds > naptime) { sleeping = false }
  }
}

const jobs = {
  'slowSleepJob': {
    plugins: [],
    pluginOptions: {},
    perform: async () => {
      await new Promise((resolve) => {
        setTimeout(() => {
          resolve(new Date().getTime())
        }, 1000)
      })
    }
  },
  'slowCPUJob': {
    plugins: [],
    pluginOptions: {},
    perform: async () => {
      blockingSleep(1000)
      return new Date().getTime()
    }
  }
}

describe('multiWorker', function () {
  before(async () => {
    await specHelper.connect()
    queue = new NodeResque.Queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue})
    await queue.connect()
  })

  before(async () => {
    multiWorker = new NodeResque.MultiWorker({
      connection: specHelper.cleanConnectionDetails(),
      timeout: specHelper.timeout,
      checkTimeout: checkTimeout,
      minTaskProcessors: minTaskProcessors,
      maxTaskProcessors: maxTaskProcessors,
      queues: [specHelper.queue],
      toDisconnectProcessors: toDisconnectProcessors
    }, jobs)

    await multiWorker.end()

    multiWorker.on('error', (error) => { throw error })
  })

  afterEach(async () => {
    await queue.delQueue(specHelper.queue)
  })

  it('should never have less than one worker', async () => {
    multiWorker.workers.length.should.equal(0)
    await multiWorker.start()
    await new Promise((resolve) => { setTimeout(resolve, (checkTimeout * 3) + 500) })

    multiWorker.workers.length.should.be.above(0)
    await multiWorker.end()
  })

  it('should stop adding workers when the max is hit & CPU utilization is low', async function () {
    this.timeout(10 * 1000)

    var i = 0
    while (i < 100) {
      await queue.enqueue(specHelper.queue, 'slowSleepJob', [])
      i++
    }

    await multiWorker.start()
    await new Promise((resolve) => { setTimeout(resolve, (checkTimeout * 30)) })
    multiWorker.workers.length.should.equal(maxTaskProcessors)
    await multiWorker.end()
  })

  it('should not add workers when CPU utilization is high', async function () {
    this.timeout(30 * 1000)

    var i = 0
    while (i < 100) {
      await queue.enqueue(specHelper.queue, 'slowCPUJob', [])
      i++
    }

    await multiWorker.start()
    await new Promise((resolve) => { setTimeout(resolve, (checkTimeout * 30)) })
    multiWorker.workers.length.should.equal(minTaskProcessors)
    await multiWorker.end()
  })

  it('should pass on all worker emits to the instance of multiWorker', async () => {
    await queue.enqueue(specHelper.queue, 'missingJob', [])

    await new Promise((resolve, reject) => {
      multiWorker.start()

      multiWorker.on('failure', async (workerId, queue, job, error) => {
        String(error).should.equal('Error: No job defined for class "missingJob"')
        multiWorker.removeAllListeners('error')
        await multiWorker.end()
        resolve()
      })
    })
  })
})
