const path = require('path')
const NodeResque = require(path.join(__dirname, '..', 'index.js'))
// In your projects: var NodeResque = require('node-resque');

// ////////////////////////
// SET UP THE CONNECTION //
// ////////////////////////

const connectionDetails = {
  pkg: 'ioredis',
  host: '127.0.0.1',
  password: null,
  port: 6379,
  database: 0
  // namespace: 'resque',
  // looping: true,
  // options: {password: 'abc'},
}

async function boot () {
  // ///////////////////////////
  // DEFINE YOUR WORKER TASKS //
  // ///////////////////////////

  const jobs = {
    'add': {
      plugins: ['JobLock'],
      pluginOptions: {
        JobLock: {}
      },
      perform: async (a, b) => {
        await new Promise((resolve) => { setTimeout(resolve, 1000) })
        let answer = a + b
        return answer
      }
    }
  }

  // //////////////////////////////
  // BUILD A WORKER & WORK A JOB //
  // //////////////////////////////

  var worker = new NodeResque.Worker({connection: connectionDetails, queues: ['math', 'otherQueue']}, jobs)
  await worker.connect()
  let result = await worker.performInline('add', [1, 2])
  console.log('Result: ' + result)

  process.exit()
}

boot()
