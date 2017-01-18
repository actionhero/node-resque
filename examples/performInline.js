// ///////////////////////
// REQUIRE THE PACKAGE //
// ///////////////////////

var path = require('path')
var NR = require(path.join(__dirname, '..', 'index.js'))
// In your projects: var NR = require('node-resque');

// /////////////////////////
// SET UP THE CONNECTION //
// /////////////////////////

var connectionDetails = {
  pkg: 'ioredis',
  host: '127.0.0.1',
  password: null,
  port: 6379,
  database: 0
  // namespace: 'resque',
  // looping: true,
  // options: {password: 'abc'},
}

// ////////////////////////////
// DEFINE YOUR WORKER TASKS //
// ////////////////////////////

var jobs = {
  'add': {
    plugins: ['jobLock'],
    pluginOptions: {
      jobLock: {}
    },
    perform: function (a, b, callback) {
      setTimeout(function () {
        var answer = a + b
        callback(null, answer)
      }, 1000)
    }
  }
}

// ///////////////////////////////
// BUILD A WORKER & WORK A JOB //
// ///////////////////////////////

var Worker = NR.worker
var worker = new Worker({connection: connectionDetails, queues: ['math', 'otherQueue']}, jobs)
worker.connect(function () {
  worker.performInline('add', [1, 2], function (error, result) {
    console.log('Error: ' + error)
    console.log('Result: ' + result)

    process.exit()
  })
})
