import { EventEmitter } from "events";
import * as os from "os";
import { ErrorPayload } from "../types/errorPayload";
import { Jobs } from "../types/jobs";
import { ConnectionOptions } from "../types/options";
import { Connection } from "./connection";
import { RunPlugins } from "./pluginRunner";

function arrayify(o) {
  if (Array.isArray(o)) {
    return o;
  } else {
    return [o];
  }
}

export declare interface Queue {
  connection: Connection;
  options: ConnectionOptions;
  jobs: Jobs;

  on(event: "error", cb: (error: Error, queue: string) => void): this;
  once(event: "error", cb: (error: Error, queue: string) => void): this;
}
export class Queue extends EventEmitter {
  constructor(options, jobs = {}) {
    super();

    this.options = options;
    this.jobs = jobs;

    this.connection = new Connection(options.connection);
    this.connection.on("error", (error) => {
      this.emit("error", error);
    });
  }

  async connect() {
    return this.connection.connect();
  }

  async end() {
    return this.connection.end();
  }

  encode(q: string, func: string, args: Array<any> = []) {
    return JSON.stringify({
      class: func,
      queue: q,
      args: args,
    });
  }

  /**
   * - Enqueue a named job (defined in `jobs` to be worked by a worker)
   * - The job will be added to the `queueName` queue, and that queue will be worked down by available workers assigned to that queue
   * - args is optional, but should be an array of arguments passed to the job. Order of arguments is maintained
   */
  async enqueue(q: string, func: string, args: Array<any> = []) {
    args = arrayify(args);
    const job = this.jobs[func];

    const toRun = await RunPlugins(this, "beforeEnqueue", func, q, job, args);
    if (toRun === false) {
      return toRun;
    }

    await this.connection.redis.sadd(this.connection.key("queues"), q);
    await this.connection.redis.rpush(
      this.connection.key("queue", q),
      this.encode(q, func, args)
    );
    await RunPlugins(this, "afterEnqueue", func, q, job, args);
    return toRun;
  }

  /**
   * - In ms, the unix timestamp at which this job is able to start being worked on.
   * - Depending on the number of other jobs in `queueName`, it is likely that this job will not be excecuted at exactly the time specified, but shortly thereafter.
   * - other options the same as `queue.enqueue`
   */
  async enqueueAt(
    timestamp: number,
    q: string,
    func: string,
    args: Array<any> = []
  ) {
    // Don't run plugins here, they should be run by scheduler at the enqueue step
    args = arrayify(args);
    const item = this.encode(q, func, args);
    const rTimestamp = Math.round(timestamp / 1000); // assume timestamp is in ms

    const match = "delayed:" + rTimestamp;
    const foundMatch = await this.connection.redis.sismember(
      this.connection.key("timestamps:" + item),
      match
    );
    if (foundMatch === 1) {
      throw new Error("Job already enqueued at this time with same arguments");
    }

    await this.connection.redis
      .multi()
      .rpush(this.connection.key("delayed:" + rTimestamp), item)
      .sadd(this.connection.key("timestamps:" + item), "delayed:" + rTimestamp)
      .zadd(
        this.connection.key("delayed_queue_schedule"),
        rTimestamp.toString(),
        rTimestamp.toString()
      )
      .exec();
  }
  /**
   * - In ms, the number of ms to delay before this job is able to start being worked on.
   *  - Depending on the number of other jobs in `queueName`, it is likely that this job will not be excecuted at exactly the delay specified, but shortly thereafter.
   * - other options the same as `queue.enqueue`
   */
  async enqueueIn(
    time: number,
    q: string,
    func: string,
    args: Array<any> = []
  ) {
    const timestamp = new Date().getTime() + parseInt(time.toString(), 10);
    return this.enqueueAt(timestamp, q, func, args);
  }

  /**
   * - queues is an Array with the names of all your queues
   */
  async queues() {
    return this.connection.redis.smembers(this.connection.key("queues"));
  }

  /**
   * - delete a queue, and all jobs in that queue.
   */
  async delQueue(q: string) {
    const { redis } = this.connection;
    await redis
      .multi()
      .del(this.connection.key("queue", q))
      .srem(this.connection.key("queues"), q)
      .exec();
  }

  /**
   * - length is an integer counting the length of the jobs in the queue
   * - this does not include delayed jobs for this queue
   */
  async length(q: string) {
    return this.connection.redis.llen(this.connection.key("queue", q));
  }

  /**
   * - jobs are deleted by those matching a `func` and agument collection within a given queue.
   * - You might match none, or you might match many.
   */
  async del(q: string, func: string, args: Array<any> = [], count: number = 0) {
    args = arrayify(args);
    return this.connection.redis.lrem(
      this.connection.key("queue", q),
      count,
      this.encode(q, func, args)
    );
  }

  async delDelayed(q: string, func: string, args: Array<any> = []) {
    const timestamps = [];
    args = arrayify(args);
    const search = this.encode(q, func, args);

    const members = await this.connection.redis.smembers(
      this.connection.key("timestamps:" + search)
    );

    for (const i in members) {
      const key = members[i];
      const count = await this.connection.redis.lrem(
        this.connection.key(key),
        0,
        search
      );
      if (count > 0) {
        timestamps.push(key.split(":")[key.split(":").length - 1]);
        await this.connection.redis.srem(
          this.connection.key("timestamps:" + search),
          key
        );
      }
    }

    return timestamps;
  }

  /**
   * - learn the timestamps at which a job is scheduled to be run.
   * - `timestampsForJob` is an array of integers
   */
  async scheduledAt(q: string, func: string, args: Array<any> = []) {
    const timestamps = [];
    args = arrayify(args);
    const search = this.encode(q, func, args);

    const members = await this.connection.redis.smembers(
      this.connection.key("timestamps:" + search)
    );
    members.forEach((key) => {
      timestamps.push(key.split(":")[key.split(":").length - 1]);
    });

    return timestamps;
  }

  /**
   * - `timestamps` is an array of integers for all timestamps which have at least one job scheduled in the future
   */
  async timestamps() {
    const results = [];
    const timestamps = await this.connection.getKeys(
      this.connection.key("delayed:*")
    );
    timestamps.forEach((timestamp) => {
      const parts = timestamp.split(":");
      results.push(parseInt(parts[parts.length - 1]) * 1000);
    });

    results.sort();
    return results;
  }

  /**
   * - `jobsEnqueuedForThisTimestamp` is an array, matching the style of the response of `queue.queued`
   */
  async delayedAt(timestamp: number) {
    const rTimestamp = Math.round(timestamp / 1000); // assume timestamp is in ms
    const items = await this.connection.redis.lrange(
      this.connection.key("delayed:" + rTimestamp),
      0,
      -1
    );
    const tasks = items.map((i) => {
      return JSON.parse(i);
    });
    return { tasks, rTimestamp };
  }

  /**
   * - list all the jobs (with their payloads) in a queue between start index and stop index.
   * - jobs is an array containing the payload of the job enqueued
   */
  async queued(q: string, start: number, stop: number) {
    const items = await this.connection.redis.lrange(
      this.connection.key("queue", q),
      start,
      stop
    );
    const tasks = items.map(function (i) {
      return JSON.parse(i);
    });
    return tasks;
  }

  /**
   * - jobsHash is an object with its keys being timestamps, and the values are arrays of jobs at each time.
   * - note that this operation can be very slow and very ram-heavy
   */
  async allDelayed() {
    const results = {};

    const timestamps = await this.timestamps();
    for (const i in timestamps) {
      const timestamp = timestamps[i];
      const { tasks, rTimestamp } = await this.delayedAt(timestamp);
      results[rTimestamp * 1000] = tasks;
    }

    return results;
  }

  /**
   * - types of locks include queue and worker locks, as created by the plugins below
   * - `locks` is a hash by type and timestamp
   */
  async locks() {
    let keys: Array<string> = [];
    const data = {};
    let _keys: Array<string>;
    let values = [];

    _keys = await this.connection.getKeys(this.connection.key("lock:*"));
    keys = keys.concat(_keys);

    _keys = await this.connection.getKeys(this.connection.key("workerslock:*"));
    keys = keys.concat(_keys);

    if (keys.length === 0) {
      return data;
    }

    // const values = await this.connection.redis.mget(keys)
    for (const i in keys) {
      let value = await this.connection.redis.get(keys[i]);
      values.push(value);
    }

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      k = k.replace(this.connection.key(""), "");
      if (k[0] === ":") {
        k = k.substr(1);
      }
      data[k] = values[i];
    }

    return data;
  }

  /**
   * - `count` is an integer. You might delete more than one lock by the name.
   */
  async delLock(key) {
    return this.connection.redis.del(this.connection.key(key));
  }

  /**
   * - returns a hash of the form: `{ 'host:pid': 'queue1, queue2', 'host:pid': 'queue1, queue2' }`
   */
  async workers() {
    const workers = {};

    const results = await this.connection.redis.smembers(
      this.connection.key("workers")
    );
    results.forEach(function (r) {
      const parts = r.split(":");
      let name;
      let queues;
      if (parts.length === 1) {
        name = parts[0];
        workers[name] = null;
      } else if (parts.length === 2) {
        name = parts[0];
        queues = parts[1];
        workers[name] = queues;
      } else {
        name = parts.shift() + ":" + parts.shift();
        queues = parts.join(":");
        workers[name] = queues;
      }
    });

    return workers;
  }

  /**
   * - returns: `{"run_at":"Fri Dec 12 2014 14:01:16 GMT-0800 (PST)","queue":"test_queue","payload":{"class":"slowJob","queue":"test_queue","args":[null]},"worker":"workerA"}`
   */
  async workingOn(workerName, queues) {
    const fullWorkerName = workerName + ":" + queues;
    return this.connection.redis.get(
      this.connection.key("worker", fullWorkerName)
    );
  }

  /**
   * - returns a hash of the results of `queue.workingOn` with the worker names as keys.
   */
  async allWorkingOn() {
    const results = {};

    const workers = await this.workers();
    for (const i in Object.keys(workers)) {
      const w = Object.keys(workers)[i];
      results[w] = "started";
      let data = await this.workingOn(w, workers[w]);
      if (data) {
        let parsedData = JSON.parse(data);
        results[parsedData.worker] = parsedData;
      }
    }

    return results;
  }

  async forceCleanWorker(workerName: string) {
    let errorPayload: ErrorPayload;

    const workers = await this.workers();
    const queues = workers[workerName];

    if (!queues) {
      this.emit(
        "error",
        `force-cleaning worker ${workerName}, but cannot find queues`
      );
    } else {
      let workingOn = await this.workingOn(workerName, queues);
      const message = "Worker Timeout (killed manually)";
      if (workingOn) {
        let parsedWorkingOn = JSON.parse(workingOn);
        errorPayload = {
          worker: workerName,
          queue: parsedWorkingOn.queue,
          payload: parsedWorkingOn.payload || {},
          exception: message,
          error: message,
          backtrace: [
            `killed by ${os.hostname} at ${new Date()}`,
            "queue#forceCleanWorker",
            "node-resque",
          ],
          failed_at: new Date().toString(),
        };
      }

      await this.connection.redis.incr(this.connection.key("stat", "failed"));
      await this.connection.redis.incr(
        this.connection.key("stat", "failed", workerName)
      );
      if (errorPayload) {
        await this.connection.redis.rpush(
          this.connection.key("failed"),
          JSON.stringify(errorPayload)
        );
      }
    }

    await this.connection.redis.del(
      this.connection.key("stat", "failed", workerName)
    );
    await this.connection.redis.del(
      this.connection.key("stat", "processed", workerName)
    );
    await this.connection.redis.del(
      this.connection.key("worker", "ping", workerName)
    );
    await this.connection.redis.del(
      this.connection.key("worker", workerName, queues, "started")
    );
    await this.connection.redis.del(this.connection.key("worker", workerName));
    await this.connection.redis.srem(
      this.connection.key("workers"),
      workerName + ":" + queues
    );

    return errorPayload;
  }

  async cleanOldWorkers(age: number) {
    // note: this method will remove the data created by a 'stuck' worker and move the payload to the error queue
    // however, it will not actually remove any processes which may be running.  A job *may* be running that you have removed
    var results = {};

    const data = await this.allWorkingOn();
    for (const i in Object.keys(data)) {
      const workerName = Object.keys(data)[i];
      if (
        data[workerName].run_at &&
        Date.now() - Date.parse(data[workerName].run_at) > age
      ) {
        const errorPayload = await this.forceCleanWorker(workerName);
        if (errorPayload && errorPayload.worker) {
          results[errorPayload.worker] = errorPayload;
        }
      }
    }

    return results;
  }

  /**
   * - `failedCount` is the number of jobs in the failed queue
   */
  async failedCount() {
    return this.connection.redis.llen(this.connection.key("failed"));
  }

  /**
   * - `failedJobs` is an array listing the data of the failed jobs. Each element looks like:
   * ```
   * {"worker": "host:pid", "queue": "test_queue", "payload": {"class":"slowJob", "queue":"test_queue", "args":[null]}, "exception": "TypeError", "error": "MyImport is not a function", "backtrace": [' at Worker.perform (/path/to/worker:111:24)', ' at <anonymous>'], "failed_at": "Fri Dec 12 2014 14:01:16 GMT-0800 (PST)"}\
   * ```
   * - To retrieve all failed jobs, use arguments: `await queue.failed(0, -1)`
   */
  async failed(start: number, stop: number) {
    const data = await this.connection.redis.lrange(
      this.connection.key("failed"),
      start,
      stop
    );
    const results = data.map((i) => {
      return JSON.parse(i);
    });
    return results;
  }

  async removeFailed(failedJob: ErrorPayload) {
    return this.connection.redis.lrem(
      this.connection.key("failed"),
      1,
      JSON.stringify(failedJob)
    );
  }

  async retryAndRemoveFailed(failedJob: ErrorPayload) {
    const countFailed = await this.removeFailed(failedJob);
    if (countFailed < 1) {
      throw new Error("This job is not in failed queue");
    }
    return this.enqueue(
      failedJob.queue,
      failedJob.payload.class,
      failedJob.payload.args
    );
  }

  /**
   * - stats will be a hash containing details about all the queues in your redis, and how many jobs are in each
   */
  async stats() {
    const data = {};
    const keys = await this.connection.getKeys(this.connection.key("stat:*"));
    if (keys.length === 0) {
      return data;
    }

    const values = await this.connection.redis.mget(keys);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      k = k.replace(this.connection.key("stat:"), "");
      data[k] = values[i];
    }

    return data;
  }
}
