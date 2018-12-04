const NodeResque = require('../index.js')
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

  const jobs = {
    'stuck': {
      perform: async function () {
        console.log(`${this.name} is starting stuck job...`)
        await new Promise((resolve) => {
          clearTimeout(this.pingTimer)// stop the worker from checkin in, like the process crashed
          setTimeout(resolve, 60 * 60 * 1000) // 1 hour job
        })
      }
    }
  }

  // /////////////////
  // START A WORKER //
  // /////////////////

  const worker = new NodeResque.Worker({ connection: connectionDetails, queues: ['stuckJobs'] }, jobs)
  await worker.connect()
  worker.start()

  // ////////////////////
  // START A SCHEDULER //
  // ////////////////////

  const scheduler = new NodeResque.Scheduler({
    stuckWorkerTimeout: (10 * 1000),
    connection: connectionDetails
  })

  await scheduler.connect()
  scheduler.start()

  // //////////////////////
  // REGESTER FOR EVENTS //
  // //////////////////////

  worker.on('start', () => { console.log('worker started') })
  worker.on('end', () => { console.log('worker ended') })
  worker.on('cleaning_worker', (worker, pid) => { console.log(`cleaning old worker ${worker}`) })
  worker.on('poll', (queue) => { console.log(`worker polling ${queue}`) })
  worker.on('ping', (time) => { console.log(`worker check in @ ${time}`) })
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

  scheduler.on('cleanStuckWorker', (workerName, errorPayload, delta) => {
    console.log(`failing ${workerName} (stuck for ${delta}s) and failing job: ${JSON.stringify(errorPayload)}`)
    process.exit()
  })

  // //////////////////////
  // CONNECT TO A QUEUE //
  // //////////////////////

  const queue = new NodeResque.Queue({ connection: connectionDetails }, jobs)
  queue.on('error', function (error) { console.log(error) })
  await queue.connect()
  await queue.enqueue('stuckJobs', 'stuck', ['oh no'])
}

boot()
