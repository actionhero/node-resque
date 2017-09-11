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
  // // options: {password: 'abc'},
}

async function boot () {
  // ///////////////////////////
  // DEFINE YOUR WORKER TASKS //
  // ///////////////////////////

  let jobsToComplete = 0

  const jobs = {
    'brokenJob': {
      plugins: [],
      pluginOptions: {},
      perform: function (a, b) {
        jobsToComplete--
        tryShutdown()

        throw new Error('broken message from job')
      }
    }
  }

  // just a helper for this demo
  async function tryShutdown () {
    if (jobsToComplete === 0) {
      await new Promise((resolve) => { setTimeout(resolve, 500) })
      await worker.end()
      process.exit()
    }
  }

  // /////////////////
  // START A WORKER //
  // /////////////////

  const worker = new NodeResque.Worker({connection: connectionDetails, queues: ['default']}, jobs)
  await worker.connect()
  await worker.workerCleanup() // optional: cleanup any previous improperly shutdown workers on this host
  worker.start()

  // //////////////////////
  // REGESTER FOR EVENTS //
  // //////////////////////

  worker.on('start', () => { console.log('worker started') })
  worker.on('end', () => { console.log('worker ended') })
  worker.on('cleaning_worker', (worker, pid) => { console.log(`cleaning old worker ${worker}`) })
  worker.on('poll', (queue) => { console.log(`worker polling ${queue}`) })
  worker.on('job', (queue, job) => { console.log(`working job ${queue} ${JSON.stringify(job)}`) })
  worker.on('reEnqueue', (queue, job, plugin) => { console.log(`reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`) })
  worker.on('success', (queue, job, result) => { console.log(`job success ${queue} ${JSON.stringify(job)} >> ${result}`) })
  worker.on('failure', (queue, job, failure) => { console.log(`job failure ${queue} ${JSON.stringify(job)} >> ${failure}`) })
  worker.on('error', (error, queue, job) => { console.log(`error ${queue} ${JSON.stringify(job)}  >> ${error}`) })
  worker.on('pause', () => { console.log('worker paused') })

  // /////////////////////
  // CONNECT TO A QUEUE //
  // /////////////////////

  const queue = new NodeResque.Queue({connection: connectionDetails}, jobs)
  await queue.connect()
  await queue.enqueue('default', 'brokenJob', [1, 2])
  jobsToComplete = 1
}

boot()
