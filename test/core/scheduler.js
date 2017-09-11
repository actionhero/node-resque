const path = require('path')
const specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
const should = require('should')
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

let scheduler
let queue

describe('scheduler', () => {
  it('can connect', async () => {
    scheduler = new NodeResque.Scheduler({connection: specHelper.connectionDetails, timeout: specHelper.timeout})
    await scheduler.connect()
    await scheduler.end()
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

    scheduler = new NodeResque.Scheduler({connection: connectionDetails, timeout: specHelper.timeout})

    scheduler.on('poll', () => { throw new Error('Should not emit poll') })
    scheduler.on('master', () => { throw new Error('Should not emit master') })

    await new Promise((resolve) => {
      scheduler.connect()

      scheduler.on('error', (error) => {
        error.message.should.match(/getaddrinfo ENOTFOUND/)
        scheduler.end()
        resolve()
      })
    })
  })

  describe('locking', () => {
    before(async () => { await specHelper.connect() })
    beforeEach(async () => { await specHelper.cleanup() })
    after(async () => { await specHelper.cleanup() })

    it('should only have one master, and can failover', async () => {
      const shedulerOne = new NodeResque.Scheduler({connection: specHelper.connectionDetails, name: 'scheduler_1', timeout: specHelper.timeout})
      const shedulerTwo = new NodeResque.Scheduler({connection: specHelper.connectionDetails, name: 'scheduler_2', timeout: specHelper.timeout})

      await shedulerOne.connect()
      await shedulerTwo.connect()
      await shedulerOne.start()
      await shedulerTwo.start()

      await new Promise((resolve) => { setTimeout(resolve, specHelper.timeout * 2) })
      shedulerOne.master.should.equal(true)
      shedulerTwo.master.should.equal(false)
      await shedulerOne.end()

      await new Promise((resolve) => { setTimeout(resolve, specHelper.timeout * 2) })
      shedulerOne.master.should.equal(false)
      shedulerTwo.master.should.equal(true)
      await shedulerTwo.end()
    })
  })

  describe('[with connection]', function () {
    before(async () => { await specHelper.connect() })
    after(async () => { await specHelper.cleanup() })

    beforeEach(async () => {
      await specHelper.cleanup()
      scheduler = new NodeResque.Scheduler({connection: specHelper.connectionDetails, timeout: specHelper.timeout})
      queue = new NodeResque.Queue({connection: specHelper.connectionDetails, queue: specHelper.queue})
      await scheduler.connect()
      await queue.connect()
    })

    it('can start and stop', async () => {
      await scheduler.start()
      await scheduler.end()
    })

    it('will move enqueued jobs when the time comes', async () => {
      await queue.enqueueAt(1000 * 10, specHelper.queue, 'someJob', [1, 2, 3])
      await scheduler.poll()
      let obj = await specHelper.popFromQueue()
      should.exist(obj)
      obj = JSON.parse(obj)
      obj['class'].should.equal('someJob')
      obj.args.should.eql([1, 2, 3])
    })

    it('will not move jobs in the future', async () => {
      await queue.enqueueAt((new Date().getTime() + 10000), specHelper.queue, 'someJob', [1, 2, 3])
      await scheduler.poll()
      let obj = await specHelper.popFromQueue()
      should.not.exist(obj)
    })
  })
})
