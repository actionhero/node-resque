const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should') // eslint-disable-line
const os = require('os')
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

let jobs = {
  'add': {
    perform: (a, b) => {
      var answer = a + b
      return answer
    }
  },
  'badAdd': {
    perform: () => {
      throw new Error('Blue Smoke')
    }
  },
  'messWithData': {
    perform: (a) => {
      a.data = 'new thing'
      return a
    }
  },
  'async': {
    perform: async () => {
      await new Promise((resolve) => { setTimeout(resolve, 100) })
      return 'yay'
    }
  },
  'quickDefine': async () => { return 'ok' }
}

let worker
let queue

describe('worker', () => {
  it('can connect', async () => {
    let worker = new NodeResque.Worker({connection: specHelper.connectionDetails, queues: specHelper.queue})
    await worker.connect()
    await worker.end()
  })

  it('can provide an error if connection failed', async () => {
    let connectionDetails = {
      pkg: specHelper.connectionDetails.pkg,
      host: 'wronghostname',
      password: specHelper.connectionDetails.password,
      port: specHelper.connectionDetails.port,
      database: specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace
    }

    let worker = new NodeResque.Worker({connection: connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue})

    await new Promise((resolve) => {
      worker.connect()

      worker.on('error', (error) => {
        error.message.should.match(/getaddrinfo ENOTFOUND/)
        worker.end()
        resolve()
      })
    })
  })

  describe('performInline', () => {
    before(() => {
      worker = new NodeResque.Worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue}, jobs)
    })

    it('can run a successful job', async () => {
      let result = await worker.performInline('add', [1, 2])
      result.should.equal(3)
    })

    it('can run a successful async job', async () => {
      let result = await worker.performInline('async')
      result.should.equal('yay')
    })

    it('can run a failing job', async () => {
      try {
        await worker.performInline('badAdd', [1, 2])
        throw new Error('should not get here')
      } catch (error) {
        String(error).should.equal('Error: Blue Smoke')
      }
    })
  })

  describe('[with connection]', () => {
    before(async () => {
      await specHelper.connect()
      queue = new NodeResque.Queue({connection: specHelper.connectionDetails})
      await queue.connect()
    })

    after(async () => { await specHelper.cleanup() })

    it('can boot and stop', async () => {
      worker = new NodeResque.Worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue}, jobs)
      await worker.connect()
      await worker.start()
      await worker.end()
    })

    describe('crashing workers', () => {
      it('can clear previously crashed workers from the same host', async () => {
        let name1 = os.hostname() + ':' + '0' // fake pid
        let name2 = os.hostname() + ':' + process.pid // real pid
        let worker1 = new NodeResque.Worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, name: name1}, jobs)

        await worker1.connect()
        await worker1.init()
        worker1.running = false

        await new Promise((resolve) => { setTimeout(resolve, 500) })

        let worker2 = new NodeResque.Worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, name: name2}, jobs)
        await worker2.connect()

        await new Promise((resolve) => {
          worker2.workerCleanup()

          worker2.on('cleaning_worker', (worker, pid) => {
            worker.should.match(new RegExp(name1))
            pid.should.equal(0)
            return resolve()
          })
        })
      })
    })

    it('will determine the proper queue names', async () => {
      let worker = new NodeResque.Worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout}, jobs)
      await worker.connect()
      worker.queues.should.deepEqual([])
      await queue.enqueue(specHelper.queue, 'badAdd', [1, 2])
      await worker.checkQueues()
      worker.queues.should.deepEqual([specHelper.queue])

      await queue.del(specHelper.queue)
      await worker.end()
    })

    describe('integration', function () {
      beforeEach(async () => {
        worker = new NodeResque.Worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue}, jobs)
        await worker.connect()
      })

      afterEach(async () => { await worker.end() })

      it('will mark a job as failed', async () => {
        await queue.enqueue(specHelper.queue, 'badAdd', [1, 2])

        await new Promise(async (resolve) => {
          worker.start()

          worker.on('failure', (q, job, failire) => {
            q.should.equal(specHelper.queue)
            job['class'].should.equal('badAdd')
            failire.message.should.equal('Blue Smoke')

            worker.removeAllListeners('failire')
            return resolve()
          })
        })
      })

      it('can work a job and return succesful things', async () => {
        await queue.enqueue(specHelper.queue, 'add', [1, 2])

        await new Promise(async (resolve) => {
          worker.start()

          worker.on('success', function (q, job, result) {
            q.should.equal(specHelper.queue)
            job['class'].should.equal('add')
            result.should.equal(3)
            worker.result.should.equal(result)

            worker.removeAllListeners('success')
            return resolve()
          })
        })
      })

      it('job arguments are immutable', async () => {
        await queue.enqueue(specHelper.queue, 'messWithData', {a: 'starting value'})

        await new Promise(async (resolve) => {
          worker.start()

          worker.on('success', function (q, job, result) {
            result.a.should.equal('starting value')
            worker.result.should.equal(result)

            worker.removeAllListeners('success')
            return resolve()
          })
        })
      })

      it('can accept jobs that are simple functions', async () => {
        await queue.enqueue(specHelper.queue, 'quickDefine')

        await new Promise(async (resolve) => {
          worker.start()

          worker.on('success', function (q, job, result) {
            result.should.equal('ok')
            worker.removeAllListeners('success')
            return resolve()
          })
        })
      })

      it('will not work jobs that are not defined', async () => {
        await queue.enqueue(specHelper.queue, 'somethingFake')

        await new Promise(async (resolve) => {
          worker.start()

          worker.on('failure', function (q, job, failure) {
            q.should.equal(specHelper.queue)
            String(failure).should.equal('Error: No job defined for class "somethingFake"')

            worker.removeAllListeners('failure')
            return resolve()
          })
        })
      })

      it('will place failed jobs in the failed queue', async () => {
        let data = await specHelper.redis.rpop(specHelper.namespace + ':' + 'failed')
        data = JSON.parse(data)
        data.queue.should.equal(specHelper.queue)
        data.exception.should.equal('Error')
        data.error.should.equal('No job defined for class "somethingFake"')
      })
    })
  })
})
