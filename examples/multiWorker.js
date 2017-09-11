const path = require('path')
const NodeResque = require(path.join(__dirname, '..', 'index.js'))
// In your projects: var NodeResque = require('node-resque');

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

// OR

// var ioredis = require('ioredis');
// connectionDetails = { redis: new ioredis() };

async function boot () {
  // //////////////
  // DEFINE JOBS //
  // //////////////

  const blockingSleep = function (naptime) {
    var sleeping = true
    var now = new Date()
    var alarm
    var startingMSeconds = now.getTime()
    while (sleeping) {
      alarm = new Date()
      var alarmMSeconds = alarm.getTime()
      if (alarmMSeconds - startingMSeconds > naptime) { sleeping = false }
    }
  }

  const jobs = {
    'slowSleepJob': {
      plugins: [],
      pluginOptions: {},
      perform: async () => {
        let start = new Date().getTime()
        await new Promise((resolve) => { setTimeout(resolve, 1000) })
        return (new Date().getTime() - start)
      }
    },
    'slowCPUJob': {
      plugins: [],
      pluginOptions: {},
      perform: async () => {
        let start = new Date().getTime()
        blockingSleep(1000)
        return (new Date().getTime() - start)
      }
    }
  }

  // ////////////////
  // ENQUEUE TASKS //
  // ////////////////

  const queue = new NodeResque.Queue({connection: connectionDetails}, jobs)
  await queue.connect()
  var i
  i = 0
  while (i < 10) {
    await queue.enqueue('slowQueue', 'slowCPUJob', [])
    i++
  }

  i = 0
  while (i < 100) {
    await queue.enqueue('slowQueue', 'slowSleepJob', [])
    i++
  }

  // ///////
  // WORK //
  // ///////

  const multiWorker = new NodeResque.MultiWorker({
    connection: connectionDetails,
    queues: ['slowQueue']
  }, jobs)

  // normal worker emitters
  multiWorker.on('start', (workerId) => { console.log(`worker[${workerId}] started`) })
  multiWorker.on('end', (workerId) => { console.log(`worker[${workerId}] ended`) })
  multiWorker.on('cleaning_worker', (workerId, worker, pid) => { console.log('cleaning old worker ' + worker) })
  multiWorker.on('poll', (workerId, queue) => { console.log(`worker[${workerId}] polling ${queue}`) })
  multiWorker.on('job', (workerId, queue, job) => { console.log(`worker[${workerId}] working job ${queue} ${JSON.stringify(job)}`) })
  multiWorker.on('reEnqueue', (workerId, queue, job, plugin) => { console.log(`worker[${workerId}] reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`) })
  multiWorker.on('success', (workerId, queue, job, result) => { console.log(`worker[${workerId}] job success ${queue} ${JSON.stringify(job)} >> ${result}`) })
  multiWorker.on('failure', (workerId, queue, job, failure) => { console.log(`worker[${workerId}] job failure ${queue} ${JSON.stringify(job)} >> ${failure}`) })
  multiWorker.on('error', (error, workerId, queue, job) => { console.log(`worker[${workerId}] error #{queue} ${JSON.stringify(job)} >> ${error}`) })
  multiWorker.on('pause', (workerId) => { console.log(`worker[${workerId}] paused`) })

  // multiWorker emitters
  multiWorker.on('internalError', (error) => { console.log(error) })
  multiWorker.on('multiWorkerAction', (verb, delay) => { console.log(`*** checked for worker status: ${verb} (event loop delay: ${delay}ms)`) })

  multiWorker.start()

  process.on('SIGINT', async () => {
    await multiWorker.stop()
    console.log('*** ALL STOPPED ***')
    process.exit()
  })
}

boot()
