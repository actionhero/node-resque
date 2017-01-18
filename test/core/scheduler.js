var path = require('path')
var specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
var should = require('should')

describe('scheduler', function () {
  var scheduler
  var queue

  it('can connect', function (done) {
    var Scheduler = specHelper.NR.scheduler
    scheduler = new Scheduler({connection: specHelper.connectionDetails, timeout: specHelper.timeout})
    scheduler.connect(function () {
      should.exist(scheduler)
      done()
    })
  })

  it('can provide an error if connection does not establish for a long period', function (done) {
    var connectionDetails = {
      pkg: specHelper.connectionDetails.pkg,
      host: 'wronghostname',
      password: specHelper.connectionDetails.password,
      port: specHelper.connectionDetails.port,
      database: specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace
    }

    var Scheduler = specHelper.NR.scheduler
    scheduler = new Scheduler({connection: connectionDetails, timeout: specHelper.timeout})
    scheduler.queue.connect = function (callback) {
      setTimeout(function () {
        callback(new Error('Cannot connect'))
      }, 1000)
    }

    scheduler.connect()

    scheduler.start()

    scheduler.on('poll', function () {
      throw new Error('Should not emit poll')
    })

    scheduler.on('master', function () {
      throw new Error('Should not emit master')
    })

    setTimeout(done, 2000)
  })

  it('can provide an error if connection failed', function (done) {
    // Only run this test if this is using real redis
    if (process.env.FAKEREDIS === 'true' || process.env.FAKEREDIS === true) {
      return done()
    }

    var connectionDetails = {
      pkg: specHelper.connectionDetails.pkg,
      host: 'wronghostname',
      password: specHelper.connectionDetails.password,
      port: specHelper.connectionDetails.port,
      database: specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace
    }

    var Scheduler = specHelper.NR.scheduler
    scheduler = new Scheduler({connection: connectionDetails, timeout: specHelper.timeout})
    scheduler.connect(function () {
      throw new Error('should not get here')
    })

    scheduler.on('error', function (error) {
      error.message.should.match(/getaddrinfo ENOTFOUND/)
      scheduler.end()
      done()
    })
  })

  describe('locking', function () {
    before(function (done) { specHelper.connect(done) })
    beforeEach(function (done) { specHelper.cleanup(done) })
    after(function (done) { specHelper.cleanup(done) })

    it('should only have one master; and can failover', function (done) {
      var Scheduler = specHelper.NR.scheduler
      var shedulerOne = new Scheduler({connection: specHelper.connectionDetails, name: 'scheduler_1', timeout: specHelper.timeout})
      var shedulerTwo = new Scheduler({connection: specHelper.connectionDetails, name: 'scheduler_2', timeout: specHelper.timeout})

      shedulerOne.connect()
      shedulerTwo.connect()

      shedulerOne.start()
      shedulerTwo.start()

      setTimeout(function () {
        shedulerOne.master.should.equal(true)
        shedulerTwo.master.should.equal(false)
        shedulerOne.end()
        setTimeout(function () {
          shedulerOne.master.should.equal(false)
          shedulerTwo.master.should.equal(true)
          shedulerTwo.end(function () { done() })
        }, (specHelper.timeout * 2))
      }, (specHelper.timeout * 2))
    })
  })

  describe('[with connection]', function () {
    before(function (done) {
      specHelper.connect(done)
    })

    beforeEach(function (done) {
      specHelper.cleanup(function () {
        var Scheduler = specHelper.NR.scheduler
        var Queue = specHelper.NR.queue

        scheduler = new Scheduler({connection: specHelper.connectionDetails, timeout: specHelper.timeout})
        queue = new Queue({connection: specHelper.connectionDetails, queue: specHelper.queue})
        scheduler.connect(function () {
          queue.connect(function () {
            done()
          })
        })
      })
    })

    after(function (done) { specHelper.cleanup(done) })

    it('can boot', function (done) {
      scheduler.start()
      done()
    })

    it('can be stopped', function (done) {
      this.timeout(specHelper.timeout * 3)
      scheduler.end(function () {
        done()
      })
    })

    it('will move enqueued jobs when the time comes', function (done) {
      queue.enqueueAt(1000 * 10, specHelper.queue, 'someJob', [1, 2, 3], function () {
        scheduler.poll(function () {
          specHelper.popFromQueue(function (err, obj) {
            should.not.exist(err)
            should.exist(obj)
            obj = JSON.parse(obj)
            obj['class'].should.equal('someJob')
            obj.args.should.eql([1, 2, 3])
            done()
          })
        })
      })
    })

    it('will not move jobs in the future', function (done) {
      queue.enqueueAt((new Date().getTime() + 10000), specHelper.queue, 'someJob', [1, 2, 3], function () {
        scheduler.poll(function () {
          specHelper.popFromQueue(function (err, obj) {
            should.not.exist(err)
            should.not.exist(obj)
            done()
          })
        })
      })
    })
  })
})
