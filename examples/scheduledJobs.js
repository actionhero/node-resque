const path = require('path')
const NodeResque = require(path.join(__dirname, '..', 'index.js'))
// In your projects: var NodeResque = require('node-resque');

// We'll use https://github.com/tejasmanohar/node-schedule for this example,
// but there are many other excelent node scheduling projects
const schedule = require('node-schedule')

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
    ticktock: (time, callback) => {
      console.log(`*** THE TIME IS ${time} ***`)
      return true
    }
  }

  // /////////////////
  // START A WORKER //
  // /////////////////

  const worker = new NodeResque.Worker({connection: connectionDetails, queues: ['time']}, jobs)
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

  // //////////////
  // DEFINE JOBS //
  // //////////////

  const queue = new NodeResque.Queue({connection: connectionDetails}, jobs)
  queue.on('error', function (error) { console.log(error) })
  await queue.connect()
  schedule.scheduleJob('0,10,20,30,40,50 * * * * *', async () => { // do this job every 10 seconds, cron style
    // we want to ensure that only one instance of this job is scheduled in our enviornment at once,
    // no matter how many schedulers we have running
    if (scheduler.master) {
      console.log('>>> enquing a job')
      await queue.enqueue('time', 'ticktock', new Date().toString())
    }
  })

  // ////////////////////
  // SHUTDOWN HELPERS //
  // ////////////////////

  const shutdown = async () => {
    await scheduler.end()
    await worker.end()
    console.log('bye.')
    process.exit()
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

boot()
