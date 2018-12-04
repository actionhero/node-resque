const specHelper = require('../utils/specHelper.js')
const NodeResque = require('../../index.js')

let scheduler
let queue

describe('scheduler', () => {
  test('can connect', async () => {
    scheduler = new NodeResque.Scheduler({ connection: specHelper.connectionDetails, timeout: specHelper.timeout })
    await scheduler.connect()
    await scheduler.end()
  })

  describe('with specHelper', () => {
    beforeAll(async () => { await specHelper.connect() })
    afterAll(async () => { await specHelper.disconnect() })

    test('can provide an error if connection failed', async () => {
      let connectionDetails = {
        pkg: specHelper.connectionDetails.pkg,
        host: 'wronghostname',
        password: specHelper.connectionDetails.password,
        port: specHelper.connectionDetails.port,
        database: specHelper.connectionDetails.database,
        namespace: specHelper.connectionDetails.namespace
      }

      scheduler = new NodeResque.Scheduler({ connection: connectionDetails, timeout: specHelper.timeout })

      scheduler.on('poll', () => { throw new Error('Should not emit poll') })
      scheduler.on('master', () => { throw new Error('Should not emit master') })

      await new Promise(async (resolve) => {
        scheduler.connect()

        scheduler.on('error', async (error) => {
          expect(error.message).toMatch(/getaddrinfo ENOTFOUND/)
          await scheduler.end()
          resolve()
        })
      })
    })

    describe('locking', () => {
      beforeEach(async () => { await specHelper.cleanup() })
      afterAll(async () => { await specHelper.cleanup() })

      test('should only have one master, and can failover', async () => {
        const shedulerOne = new NodeResque.Scheduler({ connection: specHelper.connectionDetails, name: 'scheduler_1', timeout: specHelper.timeout })
        const shedulerTwo = new NodeResque.Scheduler({ connection: specHelper.connectionDetails, name: 'scheduler_2', timeout: specHelper.timeout })

        await shedulerOne.connect()
        await shedulerTwo.connect()
        await shedulerOne.start()
        await shedulerTwo.start()

        await new Promise((resolve) => { setTimeout(resolve, specHelper.timeout * 2) })
        expect(shedulerOne.master).toBe(true)
        expect(shedulerTwo.master).toBe(false)
        await shedulerOne.end()

        await new Promise((resolve) => { setTimeout(resolve, specHelper.timeout * 2) })
        expect(shedulerOne.master).toBe(false)
        expect(shedulerTwo.master).toBe(true)
        await shedulerTwo.end()
      })
    })

    describe('[with connection]', () => {
      beforeEach(async () => {
        await specHelper.cleanup()
        scheduler = new NodeResque.Scheduler({
          connection: specHelper.connectionDetails,
          timeout: specHelper.timeout,
          stuckWorkerTimeout: 1000
        })
        queue = new NodeResque.Queue({ connection: specHelper.connectionDetails, queue: specHelper.queue })
        await scheduler.connect()
        await queue.connect()
      })

      test('can start and stop', async () => {
        await scheduler.start()
        await scheduler.end()
        await queue.end()
      })

      test('will move enqueued jobs when the time comes', async () => {
        await queue.enqueueAt(1000 * 10, specHelper.queue, 'someJob', [1, 2, 3])
        await scheduler.poll()
        let obj = await specHelper.popFromQueue()
        expect(obj).toBeDefined()
        obj = JSON.parse(obj)
        expect(obj['class']).toBe('someJob')
        expect(obj.args).toEqual([1, 2, 3])
        await scheduler.end()
      })

      test('will not move jobs in the future', async () => {
        await queue.enqueueAt((new Date().getTime() + 10000), specHelper.queue, 'someJob', [1, 2, 3])
        await scheduler.poll()
        let obj = await specHelper.popFromQueue()
        expect(obj).toBeFalsy()
        await scheduler.end()
      })

      describe('stuck workers', () => {
        let worker
        const jobs = {
          'stuck': {
            perform: async function () {
              await new Promise((resolve) => {
                // stop the worker from checkin in, like the process crashed
                // don't resolve
                clearTimeout(this.pingTimer)
              })
            }
          }
        }

        beforeAll(async () => {
          worker = new NodeResque.Worker({
            connection: specHelper.connectionDetails,
            timeout: specHelper.timeout,
            queues: ['stuckJobs']
          }, jobs)
          await worker.connect()
        })

        afterAll(async () => {
          await scheduler.end()
          await worker.end()
        })

        test('will remove stuck workers and fail thier jobs', async () => {
          await scheduler.connect()
          await scheduler.start()
          await worker.start()

          const workers = await queue.allWorkingOn()
          let h = {}
          h[worker.name] = 'started'
          expect(workers).toEqual(h)

          await queue.enqueue('stuckJobs', 'stuck', ['oh no!'])

          await new Promise(async (resolve) => {
            scheduler.on('cleanStuckWorker', async (workerName, errorPayload, delta) => {
              // response data should contain failure
              expect(workerName).toEqual(worker.name)
              expect(errorPayload.worker).toEqual(worker.name)
              expect(errorPayload.error).toEqual('Worker Timeout (killed manually)')

              // check the workers list, should be empty now
              expect(await queue.allWorkingOn()).toEqual({})

              // check the failed list
              let failed = await specHelper.redis.rpop(specHelper.namespace + ':' + 'failed')
              failed = JSON.parse(failed)
              expect(failed.queue).toBe('stuckJobs')
              expect(failed.exception).toBe('Worker Timeout (killed manually)')
              expect(failed.error).toBe('Worker Timeout (killed manually)')

              scheduler.removeAllListeners('cleanStuckWorker')
              resolve()
            })
          })
        })
      })
    })
  })
})
