const os = require('os')
const EventEmitter = require('events').EventEmitter
const Queue = require('./queue.js').Queue
const PluginRunner = require('./pluginRunner.js')

function prepareJobs (jobs) {
  return Object.keys(jobs).reduce(function (h, k) {
    var job = jobs[k]
    h[k] = typeof job === 'function' ? { perform: job } : job
    return h
  }, {})
}

class Worker extends EventEmitter {
  constructor (options, jobs) {
    super()
    if (!jobs) { jobs = {} }

    const defaults = {
      name: os.hostname() + ':' + process.pid, // assumes only one worker per node process
      queues: '*',
      timeout: 5000,
      looping: true
    }

    for (let i in defaults) {
      if (options[i] === undefined || options[i] === null) { options[i] = defaults[i] }
    }

    this.options = options
    this.jobs = prepareJobs(jobs)
    this.name = this.options.name
    this.queues = this.options.queues
    this.error = null
    this.result = null
    this.ready = false
    this.running = false
    this.working = false
    this.job = null
    this.pingTimer = null

    this.queueObject = new Queue({ connection: options.connection }, this.jobs)
    this.queueObject.on('error', (error) => { this.emit('error', error) })
  }

  async connect () {
    await this.queueObject.connect()
    this.connection = this.queueObject.connection
    await this.checkQueues()
  }

  async start () {
    if (this.ready) {
      this.emit('start', new Date())
      await this.init()
      this.poll()
    }
  }

  async init () {
    await this.track()
    await this.connection.redis.set(
      this.connection.key('worker', this.name, this.stringQueues(), 'started'),
      Math.round((new Date()).getTime() / 1000)
    )
    await this.ping()
    this.pingTimer = setInterval(this.ping.bind(this), this.options.timeout)
  }

  async end () {
    this.running = false

    if (this.working === true) {
      await new Promise((resolve) => { setTimeout(() => { resolve() }, this.options.timeout) })
      return this.end()
    }

    if (this.connection.connected === true || this.connection.connected === undefined || this.connection.connected === null) {
      clearInterval(this.pingTimer)
      await this.untrack()
    }

    await this.queueObject.end()
    this.emit('end', new Date())
  }

  async poll (nQueue) {
    if (!nQueue) { nQueue = 0 }
    if (!this.running) { return }

    this.queue = this.queues[nQueue]
    this.emit('poll', this.queue)

    if (this.queue === null || this.queue === undefined) {
      await this.checkQueues()
      await this.pause()
      return null
    }

    if (this.working === true) {
      let error = new Error('refusing to get new job, already working')
      this.emit('error', error, this.queue)
      return null
    }

    this.working = true

    try {
      let encodedJob = await this.connection.redis.lpop(this.connection.key('queue', this.queue))
      if (encodedJob) {
        let currentJob = JSON.parse(encodedJob.toString())
        if (this.options.looping) {
          this.result = null
          return this.perform(currentJob)
        } else {
          return currentJob
        }
      } else {
        this.working = false
        if (nQueue === this.queues.length - 1) {
          await this.pause()
          return null
        } else {
          return this.poll(nQueue + 1)
        }
      }
    } catch (error) {
      this.emit('error', error, this.queue)
      this.working = false
      await this.pause()
      return null
    }
  }

  async perform (job) {
    this.job = job
    this.error = null
    let toRun

    if (!this.jobs[job['class']]) {
      this.error = new Error(`No job defined for class "${job['class']}"`)
      return this.completeJob(false)
    }

    let perform = this.jobs[job['class']].perform
    if (!perform || typeof perform !== 'function') {
      this.error = new Error(`Missing Job: "${job['class']}"`)
      return this.completeJob(false)
    }

    await this.workingOn(this.job)
    this.emit('job', this.queue, this.job)

    let triedAfterPerform = false
    try {
      toRun = await PluginRunner.RunPlugins(this, 'beforePerform', job['class'], this.queue, this.jobs[job['class']], job.args)
      if (toRun === false) { return this.completeJob(false) }

      let callableArgs = [job.args]
      if (job.args === undefined || (job.args instanceof Array) === true) {
        callableArgs = job.args
      }

      for (let i in callableArgs) {
        if ((typeof callableArgs[i] === 'object') && (callableArgs[i] !== null)) { Object.freeze(callableArgs[i]) }
      }

      this.result = await perform.apply(this, callableArgs)
      triedAfterPerform = true
      toRun = await PluginRunner.RunPlugins(this, 'afterPerform', job['class'], this.queue, this.jobs[job['class']], job.args)
      return this.completeJob(true)
    } catch (error) {
      this.error = error
      if (!triedAfterPerform) {
        try {
          await PluginRunner.RunPlugins(this, 'afterPerform', job['class'], this.queue, this.jobs[job['class']], job.args)
        } catch (error) {
          if (error && !this.error) { this.error = error }
        }
      }
      return this.completeJob(!this.error)
    }
  }

  // #performInline is used to run a job payload directly.
  // If you are planning on running a job via #performInline, this worker should also not be started, nor should be using event emitters to monitor this worker.
  // This method will also not write to redis at all, including logging errors, modify resque's stats, etc.
  async performInline (func, args) {
    let q = '_direct-queue-' + this.name
    let toRun

    if (!args) { args = [] }
    if (args !== undefined && args !== null && args instanceof Array !== true) {
      args = [args]
    }

    if (this.started) { throw new Error('Worker#performInline can not be used on a started worker') }
    if (!this.jobs[func]) { throw new Error(`No job defined for class "${func}"`) }
    if (!this.jobs[func].perform) { throw new Error(`Missing Job: "${func}"`) }

    try {
      toRun = await PluginRunner.RunPlugins(this, 'beforePerform', func, q, this.jobs[func], args)
      if (toRun === false) { return }
      this.result = await this.jobs[func].perform.apply(this, args)
      toRun = await PluginRunner.RunPlugins(this, 'afterPerform', func, q, this.jobs[func], args)
      return this.result
    } catch (error) {
      this.error = error
      throw error
    }
  }

  async completeJob (toRespond) {
    if (this.error) {
      await this.fail(this.error)
    } else if (toRespond) {
      await this.succeed(this.job)
    }

    this.working = false
    await this.connection.redis.del(this.connection.key('worker', this.name, this.stringQueues()))
    this.job = null

    if (this.options.looping) {
      this.poll()
    }
  }

  async succeed (job) {
    await this.connection.redis.incr(this.connection.key('stat', 'processed'))
    await this.connection.redis.incr(this.connection.key('stat', 'processed', this.name))
    this.emit('success', this.queue, job, this.result)
  }

  async fail (err) {
    await this.connection.redis.incr(this.connection.key('stat', 'failed'))
    await this.connection.redis.incr(this.connection.key('stat', 'failed', this.name))
    await this.connection.redis.rpush(this.connection.key('failed'), JSON.stringify(this.failurePayload(err, this.job)))
    this.emit('failure', this.queue, this.job, err)
  }

  async pause () {
    this.emit('pause')
    await new Promise((resolve) => {
      setTimeout(() => {
        this.poll()
        resolve()
      }, this.options.timeout)
    })
  }

  async workingOn (job) {
    return this.connection.redis.set(this.connection.key(
      'worker',
      this.name,
      this.stringQueues()
    ),
    JSON.stringify({
      run_at: (new Date()).toString(),
      queue: this.queue,
      payload: job,
      worker: this.name
    })
    )
  }

  async track () {
    this.running = true
    return this.connection.redis.sadd(this.connection.key('workers'), (this.name + ':' + this.stringQueues()))
  }

  async ping () {
    const name = this.name
    const nowSeconds = Math.round(new Date().getTime() / 1000)
    this.emit('ping', nowSeconds)
    const payload = JSON.stringify({
      time: nowSeconds,
      name: name,
      queues: this.stringQueues()
    })
    await this.connection.redis.set(this.connection.key('worker', 'ping', name), payload)
  }

  async untrack () {
    const name = this.name
    const queues = this.stringQueues()
    if (!this.connection || !this.connection.redis) { return }

    await this.connection.redis.srem(this.connection.key('workers'), (name + ':' + queues))
    await this.connection.redis.del(this.connection.key('worker', 'ping', name))
    await this.connection.redis.del(this.connection.key('worker', name, queues))
    await this.connection.redis.del(this.connection.key('worker', name, queues, 'started'))
    await this.connection.redis.del(this.connection.key('stat', 'failed', name))
    await this.connection.redis.del(this.connection.key('stat', 'processed', name))
  }

  async checkQueues () {
    if (typeof this.queues === 'string') {
      this.queues = this.queues.split(',')
      this.ready = true
    }

    if (Array.isArray(this.queues) && this.queues.length > 0) {
      this.ready = true
    }

    if ((this.queues[0] === '*' && this.queues.length === 1) || this.queues.length === 0) {
      this.originalQueue = '*'
      await this.untrack()
      let response = await this.connection.redis.smembers(this.connection.key('queues'))
      this.queues = (response ? response.sort() : [])
      await this.track()
    }
  }

  failurePayload (err, job) {
    return {
      worker: this.name,
      queue: this.queue,
      payload: job,
      exception: err.name,
      error: err.message,
      backtrace: err.stack ? err.stack.split('\n').slice(1) : null,
      failed_at: (new Date()).toString()
    }
  }

  stringQueues () {
    if (this.queues.length === 0) {
      return ['*'].join(',')
    } else {
      try {
        return this.queues.join(',')
      } catch (e) {
        return ''
      }
    }
  }
}

exports.Worker = Worker
