const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should') // eslint-disable-line
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

let queue
const jobDelay = 1000
let worker1
let worker2

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
    perform: (a, b) => {
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
    await queue.connect()
  })

  afterEach(async () => {
    await specHelper.cleanup()
  })

  describe('jobLock', () => {
    it('will not lock jobs since arg objects are different', async () => {
      worker1 = new NodeResque.Worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs)
      worker2 = new NodeResque.Worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs)

      worker1.on('error', (error) => { throw error })
      worker2.on('error', (error) => { throw error })

      await worker1.connect()
      await worker2.connect()

      await new Promise((resolve) => {
        let startTime = new Date().getTime()
        let completed = 0

        const onComplete = function (q, job, result) {
          completed++
          if (completed === 2) {
            worker1.end()
            worker2.end();
            (new Date().getTime() - startTime).should.be.below(jobDelay * 2)
            resolve()
          }
        }

        worker1.on('success', onComplete)
        worker2.on('success', onComplete)

        queue.enqueue(specHelper.queue, 'slowAdd', [{name: 'Walter White'}, 2])
        queue.enqueue(specHelper.queue, 'slowAdd', [{name: 'Jesse Pinkman'}, 2])

        worker1.start()
        worker2.start()
      })
    })

    it('allows the key to be specified as a function', async () => {
      let calls = 0

      await new Promise(async (resolve) => {
        let functionJobs = {
          jobLockAdd: {
            plugins: ['JobLock'],
            pluginOptions: {
              JobLock: {
                key: function () {
                  // Once to create, once to delete
                  if (++calls === 2) {
                    worker1.end()
                    resolve()
                  }
                  let key = this.worker.connection.key('customKey', Math.max.apply(Math.max, this.args))
                  return key
                }
              }
            },
            perform: (a, b) => {
              return a + b
            }
          }
        }

        worker1 = new NodeResque.Worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, functionJobs)
        worker1.on('error', (error) => { throw error })
        await worker1.connect()
        await queue.enqueue(specHelper.queue, 'jobLockAdd', [1, 2])
        worker1.start()
      })
    })

    it('will not run 2 jobs with the same args at the same time', async () => {
      let count = 0
      worker1 = new NodeResque.Worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs)
      worker2 = new NodeResque.Worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs)

      worker1.on('error', (error) => { throw error })
      worker2.on('error', (error) => { throw error })

      await new Promise(async (resolve) => {
        await worker1.connect()
        await worker2.connect()

        const onComplete = async () => {
          count++
          count.should.equal(1)
          worker1.end()
          worker2.end()

          let timestamps = await queue.timestamps()
          let dealyedJob = await specHelper.redis.lpop(specHelper.namespace + ':delayed:' + Math.round(timestamps[0] / 1000))
          should.exist(dealyedJob)
          dealyedJob = JSON.parse(dealyedJob)
          dealyedJob['class'].should.equal('slowAdd')
          dealyedJob.args.should.eql([1, 2])

          resolve()
        }

        worker1.on('success', onComplete)
        worker2.on('success', onComplete)

        await queue.enqueue(specHelper.queue, 'slowAdd', [1, 2])
        await queue.enqueue(specHelper.queue, 'slowAdd', [1, 2])

        worker1.start()
        worker2.start()
      })
    })

    it('will run 2 jobs with the different args at the same time', async () => {
      worker1 = new NodeResque.Worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs)
      worker2 = new NodeResque.Worker({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout, queues: specHelper.queue}, jobs)

      worker1.on('error', (error) => { throw error })
      worker2.on('error', (error) => { throw error })

      await worker1.connect()
      await worker2.connect()

      let startTime = new Date().getTime()
      let completed = 0

      await new Promise(async (resolve) => {
        const onComplete = function (q, job, result) {
          completed++
          if (completed === 2) {
            worker1.end()
            worker2.end()
            var delta = (new Date().getTime() - startTime)
            delta.should.be.below(jobDelay * 2)
            resolve()
          }
        }

        worker1.on('success', onComplete)
        worker2.on('success', onComplete)

        await queue.enqueue(specHelper.queue, 'slowAdd', [1, 2])
        await queue.enqueue(specHelper.queue, 'slowAdd', [3, 4])

        worker1.start()
        worker2.start()
      })
    })
  })
})
