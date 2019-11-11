import * as os from 'os'
import { EventEmitter } from 'events'
import { Connection } from './connection'
import { RunPlugins } from './pluginRunner'
import { Options } from '../types/options'
import { Jobs } from '../types/jobs'

function arrayify(o) {
  if (Array.isArray(o)) {
    return o
  } else {
    return [o]
  }
}

export class Queue extends EventEmitter {
  connection: Connection
  options: Options
  jobs: Jobs

  constructor(options, jobs) {
    super()
    if (!jobs) { jobs = {} }

    this.options = options
    this.jobs = jobs

    this.connection = new Connection(options.connection)
    this.connection.on('error', (error) => { this.emit('error', error) })
  }

  async connect() {
    return this.connection.connect()
  }

  async end() {
    return this.connection.end()
  }

  encode(q, func, args) {
    return JSON.stringify({
      class: func,
      queue: q,
      args: args || []
    })
  }

  async enqueue(q, func, args) {
    if (!args) { args = [] }
    args = arrayify(args)
    const job = this.jobs[func]

    const toRun = await RunPlugins(this, 'beforeEnqueue', func, q, job, args)
    if (toRun === false) { return toRun }

    await this.connection.redis.sadd(this.connection.key('queues'), q)
    await this.connection.redis.rpush(this.connection.key('queue', q), this.encode(q, func, args))
    await RunPlugins(this, 'afterEnqueue', func, q, job, args)
    return toRun
  }

  async enqueueAt(timestamp, q, func, args) {
    // Don't run plugins here, they should be run by scheduler at the enqueue step
    if (!args) { args = [] }
    args = arrayify(args)
    const item = this.encode(q, func, args)
    const rTimestamp = Math.round(timestamp / 1000) // assume timestamp is in ms

    const match = ('delayed:' + rTimestamp)
    const foundMatch = await this.connection.redis.sismember(this.connection.key('timestamps:' + item), match)
    if (foundMatch === 1) { throw new Error('Job already enqueued at this time with same arguments') }

    await this.connection.redis.rpush(this.connection.key('delayed:' + rTimestamp), item)
    await this.connection.redis.sadd(this.connection.key('timestamps:' + item), ('delayed:' + rTimestamp))
    await this.connection.redis.zadd(this.connection.key('delayed_queue_schedule'), rTimestamp.toString(), rTimestamp.toString())
  }

  async enqueueIn(time, q, func, args) {
    const timestamp = (new Date().getTime()) + parseInt(time, 10)
    return this.enqueueAt(timestamp, q, func, args)
  }

  async queues() {
    return this.connection.redis.smembers(this.connection.key('queues'))
  }

  async delQueue(q) {
    await this.connection.redis.del(this.connection.key('queue', q))
    await this.connection.redis.srem(this.connection.key('queues'), q)
  }

  async length(q) {
    return this.connection.redis.llen(this.connection.key('queue', q))
  }

  async del(q, func, args, count) {
    if (!args) { args = [] }
    if (!count) { count = 0 }
    args = arrayify(args)
    return this.connection.redis.lrem(this.connection.key('queue', q), count, this.encode(q, func, args))
  }

  async delDelayed(q, func, args) {
    const timestamps = []
    if (!args) { args = {} }
    args = arrayify(args)
    const search = this.encode(q, func, args)

    const members = await this.connection.redis.smembers(this.connection.key('timestamps:' + search))

    for (const i in members) {
      const key = members[i]
      const count = await this.connection.redis.lrem(this.connection.key(key), 0, search)
      if (count > 0) {
        timestamps.push(key.split(':')[key.split(':').length - 1])
        await this.connection.redis.srem(this.connection.key('timestamps:' + search), key)
      }
    }

    return timestamps
  }

  async scheduledAt(q, func, args) {
    const timestamps = []
    if (!args) { args = [] }
    args = arrayify(args)
    const search = this.encode(q, func, args)

    const members = await this.connection.redis.smembers(this.connection.key('timestamps:' + search))
    members.forEach((key) => {
      timestamps.push(key.split(':')[key.split(':').length - 1])
    })

    return timestamps
  }

  async timestamps() {
    const results = []
    const timestamps = await this.connection.getKeys(this.connection.key('delayed:*'))
    timestamps.forEach((timestamp) => {
      const parts = timestamp.split(':')
      results.push(parseInt(parts[(parts.length - 1)]) * 1000)
    })

    results.sort()
    return results
  }

  async delayedAt(timestamp) {
    const rTimestamp = Math.round(timestamp / 1000) // assume timestamp is in ms
    const items = await this.connection.redis.lrange(this.connection.key('delayed:' + rTimestamp), 0, -1)
    const tasks = items.map((i) => { return JSON.parse(i) })
    return { tasks, rTimestamp }
  }

  async queued(q, start, stop) {
    const items = await this.connection.redis.lrange(this.connection.key('queue', q), start, stop)
    const tasks = items.map(function (i) { return JSON.parse(i) })
    return tasks
  }

  async allDelayed() {
    const results = {}

    const timestamps = await this.timestamps()
    for (const i in timestamps) {
      const timestamp = timestamps[i]
      const { tasks, rTimestamp } = await this.delayedAt(timestamp)
      results[(rTimestamp * 1000)] = tasks
    }

    return results
  }

  async locks() {
    let keys: Array<string> = []
    const data = {}
    let _keys: Array<string>
    let values = []

    _keys = await this.connection.getKeys(this.connection.key('lock:*'))
    keys = keys.concat(_keys)

    _keys = await this.connection.getKeys(this.connection.key('workerslock:*'))
    keys = keys.concat(_keys)

    if (keys.length === 0) { return data }

    // const values = await this.connection.redis.mget(keys)
    for (const i in keys) {
      let value = await this.connection.redis.get(keys[i])
      values.push(value)
    }

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]
      k = k.replace(this.connection.key(''), '')
      if (k[0] === ':') { k = k.substr(1) }
      data[k] = values[i]
    }

    return data
  }

  async delLock(key) {
    return this.connection.redis.del(this.connection.key(key))
  }

  async workers() {
    const workers = {}

    const results = await this.connection.redis.smembers(this.connection.key('workers'))
    results.forEach(function (r) {
      const parts = r.split(':')
      let name
      let queues
      if (parts.length === 1) {
        name = parts[0]
        workers[name] = null
      } else if (parts.length === 2) {
        name = parts[0]
        queues = parts[1]
        workers[name] = queues
      } else {
        name = parts.shift() + ':' + parts.shift()
        queues = parts.join(':')
        workers[name] = queues
      }
    })

    return workers
  }

  async workingOn(workerName, queues) {
    const fullWorkerName = workerName + ':' + queues
    return this.connection.redis.get(this.connection.key('worker', fullWorkerName))
  }

  async allWorkingOn() {
    const results = {}

    const workers = await this.workers()
    for (const i in Object.keys(workers)) {
      const w = Object.keys(workers)[i]
      results[w] = 'started'
      let data = await this.workingOn(w, workers[w])
      if (data) {
        let parsedData = JSON.parse(data)
        results[parsedData.worker] = parsedData
      }
    }

    return results
  }

  async forceCleanWorker(workerName) {
    let errorPayload

    const workers = await this.workers()
    const queues = workers[workerName]

    if (!queues) {
      this.emit('error', `force-cleaning worker ${workerName}, but cannot find queues`)
    } else {
      let workingOn = await this.workingOn(workerName, queues)
      const message = 'Worker Timeout (killed manually)'
      if (workingOn) {
        let parsedWorkingOn = JSON.parse(workingOn)
        errorPayload = {
          worker: workerName,
          queue: parsedWorkingOn.queue,
          payload: parsedWorkingOn.payload || [],
          exception: message,
          error: message,
          backtrace: [
            `killed by ${os.hostname} at ${new Date()}`,
            'queue#forceCleanWorker',
            'node-resque'
          ],
          failed_at: (new Date()).toString()
        }
      }

      await this.connection.redis.incr(this.connection.key('stat', 'failed'))
      await this.connection.redis.incr(this.connection.key('stat', 'failed', workerName))
      if (errorPayload) {
        await this.connection.redis.rpush(this.connection.key('failed'), JSON.stringify(errorPayload))
      }
    }

    await this.connection.redis.del(this.connection.key('stat', 'failed', workerName))
    await this.connection.redis.del(this.connection.key('stat', 'processed', workerName))
    await this.connection.redis.del(this.connection.key('worker', 'ping', workerName))
    await this.connection.redis.del(this.connection.key('worker', workerName, queues, 'started'))
    await this.connection.redis.del(this.connection.key('worker', workerName))
    await this.connection.redis.srem(this.connection.key('workers'), workerName + ':' + queues)

    return errorPayload
  }

  async cleanOldWorkers(age) {
    // note: this method will remove the data created by a 'stuck' worker and move the payload to the error queue
    // however, it will not actually remove any processes which may be running.  A job *may* be running that you have removed
    var results = {}

    const data = await this.allWorkingOn()
    for (const i in Object.keys(data)) {
      const workerName = Object.keys(data)[i]
      if (data[workerName].run_at && (Date.now() - Date.parse(data[workerName].run_at) > age)) {
        const errorPayload = await this.forceCleanWorker(workerName)
        if (errorPayload && errorPayload.worker) { results[errorPayload.worker] = errorPayload }
      }
    }

    return results
  }

  async failedCount() {
    return this.connection.redis.llen(this.connection.key('failed'))
  }

  async failed(start, stop) {
    const data = await this.connection.redis.lrange(this.connection.key('failed'), start, stop)
    const results = data.map((i) => { return JSON.parse(i) })
    return results
  }

  async removeFailed(failedJob) {
    return this.connection.redis.lrem(this.connection.key('failed'), 1, JSON.stringify(failedJob))
  }

  async retryAndRemoveFailed(failedJob) {
    const countFailed = await this.removeFailed(failedJob)
    if (countFailed < 1) { throw new Error('This job is not in failed queue') }
    return this.enqueue(failedJob.queue, failedJob.payload.class, failedJob.payload.args)
  }

  async stats() {
    const data = {}
    const keys = await this.connection.getKeys(this.connection.key('stat:*'))
    if (keys.length === 0) { return data }

    const values = await this.connection.redis.mget(keys)
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]
      k = k.replace(this.connection.key('stat:'), '')
      data[k] = values[i]
    }

    return data
  }
}
