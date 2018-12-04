const specHelper = require('../utils/specHelper.js')
const NodeResque = require('../../index.js')

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
  'twoSeconds': {
    perform: async () => {
      await new Promise((resolve) => { setTimeout(resolve, 1000 * 2) })
      return 'slow'
    }
  },
  'quickDefine': async () => { return 'ok' }
}

let worker
let queue

describe('worker', () => {
  afterAll(async () => {
    await specHelper.disconnect()
  })

  test('can connect', async () => {
    let worker = new NodeResque.Worker({ connection: specHelper.connectionDetails, queues: specHelper.queue })
    await worker.connect()
    await worker.end()
  })

  test('can provide an error if connection failed', async () => {
    let connectionDetails = {
      pkg: specHelper.connectionDetails.pkg,
      host: 'wronghostname',
      password: specHelper.connectionDetails.password,
      port: specHelper.connectionDetails.port,
      database: specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace
    }

    let worker = new NodeResque.Worker({ connection: connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue })

    await new Promise(async (resolve) => {
      worker.connect()

      worker.on('error', async (error) => {
        expect(error.message).toMatch(/getaddrinfo ENOTFOUND/)
        await worker.end()
        resolve()
      })
    })
  })

  describe('performInline', () => {
    beforeAll(() => {
      worker = new NodeResque.Worker({ connection: specHelper.connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue }, jobs)
    })

    test('can run a successful job', async () => {
      let result = await worker.performInline('add', [1, 2])
      expect(result).toBe(3)
    })

    test('can run a successful async job', async () => {
      let result = await worker.performInline('async')
      expect(result).toBe('yay')
    })

    test('can run a failing job', async () => {
      try {
        await worker.performInline('badAdd', [1, 2])
        throw new Error('should not get here')
      } catch (error) {
        expect(String(error)).toBe('Error: Blue Smoke')
      }
    })
  })

  describe('[with connection]', () => {
    beforeAll(async () => {
      await specHelper.connect()
      queue = new NodeResque.Queue({ connection: specHelper.connectionDetails })
      await queue.connect()
    })

    afterAll(async () => { await specHelper.cleanup() })

    test('can boot and stop', async () => {
      worker = new NodeResque.Worker({ connection: specHelper.connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue }, jobs)
      await worker.connect()
      await worker.start()
      await worker.end()
    })

    test('will determine the proper queue names', async () => {
      let worker = new NodeResque.Worker({ connection: specHelper.connectionDetails, timeout: specHelper.timeout }, jobs)
      await worker.connect()
      expect(worker.queues).toEqual([])
      await queue.enqueue(specHelper.queue, 'badAdd', [1, 2])
      await worker.checkQueues()
      expect(worker.queues).toEqual([specHelper.queue])

      await queue.del(specHelper.queue)
      await worker.end()
    })

    describe('integration', () => {
      beforeEach(async () => {
        worker = new NodeResque.Worker({ connection: specHelper.connectionDetails, timeout: specHelper.timeout, queues: specHelper.queue }, jobs)
        await worker.connect()
      })

      afterEach(async () => { await worker.end() })

      test('will mark a job as failed', async () => {
        await queue.enqueue(specHelper.queue, 'badAdd', [1, 2])

        await new Promise(async (resolve) => {
          worker.start()

          worker.on('failure', (q, job, failire) => {
            expect(q).toBe(specHelper.queue)
            expect(job['class']).toBe('badAdd')
            expect(failire.message).toBe('Blue Smoke')

            worker.removeAllListeners('failire')
            return resolve()
          })
        })
      })

      test('can work a job and return succesful things', async () => {
        await queue.enqueue(specHelper.queue, 'add', [1, 2])

        await new Promise(async (resolve) => {
          worker.start()

          worker.on('success', (q, job, result) => {
            expect(q).toBe(specHelper.queue)
            expect(job['class']).toBe('add')
            expect(result).toBe(3)
            expect(worker.result).toBe(result)

            worker.removeAllListeners('success')
            return resolve()
          })
        })
      })

      test('job arguments are immutable', async () => {
        await queue.enqueue(specHelper.queue, 'messWithData', { a: 'starting value' })

        await new Promise(async (resolve) => {
          worker.start()

          worker.on('success', (q, job, result) => {
            expect(result.a).toBe('starting value')
            expect(worker.result).toBe(result)

            worker.removeAllListeners('success')
            return resolve()
          })
        })
      })

      test('can accept jobs that are simple functions', async () => {
        await queue.enqueue(specHelper.queue, 'quickDefine')

        await new Promise(async (resolve) => {
          worker.start()

          worker.on('success', (q, job, result) => {
            expect(result).toBe('ok')
            worker.removeAllListeners('success')
            return resolve()
          })
        })
      })

      test('will not work jobs that are not defined', async () => {
        await queue.enqueue(specHelper.queue, 'somethingFake')

        await new Promise(async (resolve) => {
          worker.start()

          worker.on('failure', (q, job, failure) => {
            expect(q).toBe(specHelper.queue)
            expect(String(failure)).toBe('Error: No job defined for class "somethingFake"')

            worker.removeAllListeners('failure')
            return resolve()
          })
        })
      })

      test('will place failed jobs in the failed queue', async () => {
        let data = await specHelper.redis.rpop(specHelper.namespace + ':' + 'failed')
        data = JSON.parse(data)
        expect(data.queue).toBe(specHelper.queue)
        expect(data.exception).toBe('Error')
        expect(data.error).toBe('No job defined for class "somethingFake"')
      })

      test('will ping with status even when working a slow job', async () => {
        const nowInSeconds = Math.round(new Date().getTime() / 1000)
        await worker.start()
        await new Promise((resolve) => setTimeout(resolve, (worker.options.timeout * 2)))
        const pingKey = worker.connection.key('worker', 'ping', worker.name)
        let firstPayload = JSON.parse(await specHelper.redis.get(pingKey))
        expect(firstPayload.name).toEqual(worker.name)
        expect(firstPayload.time).toBeGreaterThanOrEqual(nowInSeconds)

        await queue.enqueue(specHelper.queue, 'twoSeconds')

        await new Promise(async (resolve) => {
          worker.on('success', (q, job, result) => {
            expect(result).toBe('slow')
            worker.removeAllListeners('success')
            return resolve()
          })
        })

        let secondPayload = JSON.parse(await specHelper.redis.get(pingKey))
        expect(secondPayload.name).toEqual(worker.name)
        expect(secondPayload.time).toBeGreaterThanOrEqual(firstPayload.time)
      })
    })
  })
})
