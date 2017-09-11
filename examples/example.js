const path = require('path')
const NodeResque = require(path.join(__dirname, '..', 'index.js'))
// In your projects: const NodeResque = require('node-resque');

async function boot () {
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

  // ///////////////////////////
  // DEFINE YOUR WORKER TASKS //
  // ///////////////////////////

  let jobsToComplete = 0

  const jobs = {
    'add': {
      plugins: ['JobLock'],
      pluginOptions: {
        JobLock: {}
      },
      perform: async (a, b) => {
        await new Promise((resolve) => { setTimeout(resolve, 1000) })
        jobsToComplete--
        tryShutdown()

        let answer = a + b
        return answer
      }
    },
    'subtract': {
      perform: (a, b) => {
        jobsToComplete--
        tryShutdown()

        let answer = a - b
        return answer
      }
    }
  }

  // just a helper for this demo
  async function tryShutdown () {
    if (jobsToComplete === 0) {
      await new Promise((resolve) => { setTimeout(resolve, 500) })
      await scheduler.end()
      await worker.end()
      process.exit()
    }
  }

  // /////////////////
  // START A WORKER //
  // /////////////////

  const worker = new NodeResque.Worker({connection: connectionDetails, queues: ['math', 'otherQueue']}, jobs)
  await worker.connect()
  await worker.workerCleanup() // optional: cleanup any previous improperly shutdown workers on this host
  worker.start()

  // ////////////////////
  // START A SCHEDULER //
  // ////////////////////

  const scheduler = new NodeResque.Scheduler({connection: connectionDetails})
  await scheduler.connect()
  scheduler.start()

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

  scheduler.on('start', () => { console.log('scheduler started') })
  scheduler.on('end', () => { console.log('scheduler ended') })
  scheduler.on('poll', () => { console.log('scheduler polling') })
  scheduler.on('master', (state) => { console.log('scheduler became master') })
  scheduler.on('error', (error) => { console.log(`scheduler error >> ${error}`) })
  scheduler.on('workingTimestamp', (timestamp) => { console.log(`scheduler working timestamp ${timestamp}`) })
  scheduler.on('transferredJob', (timestamp, job) => { console.log(`scheduler enquing job ${timestamp} >> ${JSON.stringify(job)}`) })

  // //////////////////////
  // CONNECT TO A QUEUE //
  // //////////////////////

  const queue = new NodeResque.Queue({connection: connectionDetails}, jobs)
  queue.on('error', function (error) { console.log(error) })
  await queue.connect()
  await queue.enqueue('math', 'add', [1, 2])
  await queue.enqueue('math', 'add', [1, 2])
  await queue.enqueue('math', 'add', [2, 3])
  await queue.enqueueIn(3000, 'math', 'subtract', [2, 1])
  jobsToComplete = 4
}

boot()
