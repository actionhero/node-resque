import * as os from "os";
import { EventEmitter } from "events";
import { Connection } from "./connection";
import { Queue } from "./queue";
import { RunPlugins } from "./pluginRunner";
import { WorkerOptions } from "../types/options";
import { Job } from "../types/job";
import { Jobs } from "../types/jobs";

function prepareJobs(jobs) {
  return Object.keys(jobs).reduce(function(h, k) {
    var job = jobs[k];
    h[k] = typeof job === "function" ? { perform: job } : job;
    return h;
  }, {});
}

/**
 * ## Events
 * ```
 * worker.on("start", () => {
 *   console.log("worker started");
 * });
 * worker.on("end", () => {
 *   console.log("worker ended");
 * });
 * worker.on("cleaning_worker", (worker, pid) => {
 *   console.log(`cleaning old worker ${worker}`);
 * });
 * worker.on("poll", queue => {
 *   console.log(`worker polling ${queue}`);
 * });
 * worker.on("ping", time => {
 *   console.log(`worker check in @ ${time}`);
 * });
 * worker.on("job", (queue, job) => {
 *   console.log(`working job ${queue} ${JSON.stringify(job)}`);
 * });
 * worker.on("reEnqueue", (queue, job, plugin) => {
 *   console.log(`reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`);
 * });
 * worker.on("success", (queue, job, result) => {
 *  console.log(`job success ${queue} ${JSON.stringify(job)} >> ${result}`);
 * });
 * worker.on("failure", (queue, job, failure) => {
 *   console.log(`job failure ${queue} ${JSON.stringify(job)} >> ${failure}`);
 * });
 * worker.on("error", (error, queue, job) => {
 *   console.log(`error ${queue} ${JSON.stringify(job)}  >> ${error}`);
 * });
 * worker.on("pause", () => {
 *   console.log("worker paused");
 * });
 * ```
 */
export class Worker extends EventEmitter {
  options: WorkerOptions;
  jobs: Jobs;
  started: boolean;
  name: string;
  queues: Array<string>;
  queue: string;
  private originalQueue: string | null;
  error: Error | null;
  result: any;
  ready: boolean;
  running: boolean;
  working: boolean;
  private pingTimer: NodeJS.Timeout;
  job: Job<any>;
  connection: Connection;
  queueObject: Queue;
  id: number;

  constructor(options, jobs = {}) {
    super();

    const defaults = {
      name: os.hostname() + ":" + process.pid, // assumes only one worker per node process
      queues: "*",
      timeout: 5000,
      looping: true,
      id: 1
    };

    for (const i in defaults) {
      if (options[i] === undefined || options[i] === null) {
        options[i] = defaults[i];
      }
    }

    this.options = options;
    this.jobs = prepareJobs(jobs);
    this.name = this.options.name;
    this.queues = this.options.queues;
    this.queue = null;
    this.originalQueue = null;
    this.error = null;
    this.result = null;
    this.ready = true;
    this.running = false;
    this.working = false;
    this.job = null;
    this.pingTimer = null;
    this.started = false;

    this.queueObject = new Queue({ connection: options.connection }, this.jobs);
    this.queueObject.on("error", error => {
      this.emit("error", error);
    });
  }

  async connect() {
    await this.queueObject.connect();
    this.connection = this.queueObject.connection;
    await this.checkQueues();
  }

  async start() {
    if (this.ready) {
      this.started = true;
      this.emit("start", new Date());
      await this.init();
      this.poll();
    }
  }

  private async init() {
    await this.track();
    await this.connection.redis.set(
      this.connection.key("worker", this.name, this.stringQueues(), "started"),
      Math.round(new Date().getTime() / 1000)
    );
    await this.ping();
    this.pingTimer = setInterval(this.ping.bind(this), this.options.timeout);
  }

  async end() {
    this.running = false;

    if (this.working === true) {
      await new Promise(resolve => {
        setTimeout(() => {
          resolve();
        }, this.options.timeout);
      });
      return this.end();
    }

    if (
      this.connection &&
      (this.connection.connected === true ||
        this.connection.connected === undefined ||
        this.connection.connected === null)
    ) {
      clearInterval(this.pingTimer);
      await this.untrack();
    }

    await this.queueObject.end();
    this.emit("end", new Date());
  }

  private async poll(nQueue = 0) {
    if (!this.running) {
      return;
    }

    this.queue = this.queues[nQueue];
    this.emit("poll", this.queue);

    if (this.queue === null || this.queue === undefined) {
      await this.checkQueues();
      await this.pause();
      return null;
    }

    if (this.working === true) {
      const error = new Error("refusing to get new job, already working");
      this.emit("error", error, this.queue);
      return null;
    }

    this.working = true;

    try {
      const encodedJob = await this.connection.redis.lpop(
        this.connection.key("queue", this.queue)
      );
      if (encodedJob) {
        const currentJob = JSON.parse(encodedJob.toString());
        if (this.options.looping) {
          this.result = null;
          return this.perform(currentJob);
        } else {
          return currentJob;
        }
      } else {
        this.working = false;
        if (nQueue === this.queues.length - 1) {
          await this.pause();
          return null;
        } else {
          return this.poll(nQueue + 1);
        }
      }
    } catch (error) {
      this.emit("error", error, this.queue);
      this.working = false;
      await this.pause();
      return null;
    }
  }

  private async perform(job) {
    this.job = job;
    this.error = null;
    let toRun;

    if (!this.jobs[job.class]) {
      this.error = new Error(`No job defined for class "${job.class}"`);
      return this.completeJob(false);
    }

    const perform = this.jobs[job.class].perform;
    if (!perform || typeof perform !== "function") {
      this.error = new Error(`Missing Job: "${job.class}"`);
      return this.completeJob(false);
    }

    await this.workingOn(this.job);
    this.emit("job", this.queue, this.job);

    let triedAfterPerform = false;
    try {
      toRun = await RunPlugins(
        this,
        "beforePerform",
        job.class,
        this.queue,
        this.jobs[job.class],
        job.args
      );
      if (toRun === false) {
        return this.completeJob(false);
      }

      let callableArgs = [job.args];
      if (job.args === undefined || job.args instanceof Array === true) {
        callableArgs = job.args;
      }

      for (const i in callableArgs) {
        if (typeof callableArgs[i] === "object" && callableArgs[i] !== null) {
          Object.freeze(callableArgs[i]);
        }
      }

      this.result = await perform.apply(this, callableArgs);
      triedAfterPerform = true;
      toRun = await RunPlugins(
        this,
        "afterPerform",
        job.class,
        this.queue,
        this.jobs[job.class],
        job.args
      );
      return this.completeJob(true);
    } catch (error) {
      this.error = error;
      if (!triedAfterPerform) {
        try {
          await RunPlugins(
            this,
            "afterPerform",
            job.class,
            this.queue,
            this.jobs[job.class],
            job.args
          );
        } catch (error) {
          if (error && !this.error) {
            this.error = error;
          }
        }
      }
      return this.completeJob(!this.error);
    }
  }

  // #performInline is used to run a job payload directly.
  // If you are planning on running a job via #performInline, this worker should also not be started, nor should be using event emitters to monitor this worker.
  // This method will also not write to redis at all, including logging errors, modify resque's stats, etc.
  async performInline(func, args) {
    const q = "_direct-queue-" + this.name;
    let toRun;

    if (!args) {
      args = [];
    }
    if (args !== undefined && args !== null && args instanceof Array !== true) {
      args = [args];
    }

    if (this.started) {
      throw new Error(
        "Worker#performInline can not be used on a started worker"
      );
    }
    if (!this.jobs[func]) {
      throw new Error(`No job defined for class "${func}"`);
    }
    if (!this.jobs[func].perform) {
      throw new Error(`Missing Job: "${func}"`);
    }

    try {
      toRun = await RunPlugins(
        this,
        "beforePerform",
        func,
        q,
        this.jobs[func],
        args
      );
      if (toRun === false) {
        return;
      }
      this.result = await this.jobs[func].perform.apply(this, args);
      toRun = await RunPlugins(
        this,
        "afterPerform",
        func,
        q,
        this.jobs[func],
        args
      );
      return this.result;
    } catch (error) {
      this.error = error;
      throw error;
    }
  }

  private async completeJob(toRespond) {
    if (this.error) {
      await this.fail(this.error);
    } else if (toRespond) {
      await this.succeed(this.job);
    }

    this.working = false;
    await this.connection.redis.del(
      this.connection.key("worker", this.name, this.stringQueues())
    );
    this.job = null;

    if (this.options.looping) {
      this.poll();
    }
  }

  private async succeed(job) {
    await this.connection.redis.incr(this.connection.key("stat", "processed"));
    await this.connection.redis.incr(
      this.connection.key("stat", "processed", this.name)
    );
    this.emit("success", this.queue, job, this.result);
  }

  private async fail(err) {
    await this.connection.redis.incr(this.connection.key("stat", "failed"));
    await this.connection.redis.incr(
      this.connection.key("stat", "failed", this.name)
    );
    await this.connection.redis.rpush(
      this.connection.key("failed"),
      JSON.stringify(this.failurePayload(err, this.job))
    );
    this.emit("failure", this.queue, this.job, err);
  }

  private async pause() {
    this.emit("pause");
    await new Promise(resolve => {
      setTimeout(() => {
        this.poll();
        resolve();
      }, this.options.timeout);
    });
  }

  private async workingOn(job) {
    return this.connection.redis.set(
      this.connection.key("worker", this.name, this.stringQueues()),
      JSON.stringify({
        run_at: new Date().toString(),
        queue: this.queue,
        payload: job,
        worker: this.name
      })
    );
  }

  private async track() {
    this.running = true;
    return this.connection.redis.sadd(
      this.connection.key("workers"),
      this.name + ":" + this.stringQueues()
    );
  }

  private async ping() {
    const name = this.name;
    const nowSeconds = Math.round(new Date().getTime() / 1000);
    this.emit("ping", nowSeconds);
    const payload = JSON.stringify({
      time: nowSeconds,
      name: name,
      queues: this.stringQueues()
    });
    await this.connection.redis.set(
      this.connection.key("worker", "ping", name),
      payload
    );
  }

  private async untrack() {
    const name = this.name;
    const queues = this.stringQueues();
    if (!this.connection || !this.connection.redis) {
      return;
    }

    await this.connection.redis.srem(
      this.connection.key("workers"),
      name + ":" + queues
    );
    await this.connection.redis.del(
      this.connection.key("worker", "ping", name)
    );
    await this.connection.redis.del(
      this.connection.key("worker", name, queues)
    );
    await this.connection.redis.del(
      this.connection.key("worker", name, queues, "started")
    );
    await this.connection.redis.del(
      this.connection.key("stat", "failed", name)
    );
    await this.connection.redis.del(
      this.connection.key("stat", "processed", name)
    );
  }

  async checkQueues() {
    if (Array.isArray(this.queues) && this.queues.length > 0) {
      this.ready = true;
    }

    if (
      (this.queues[0] === "*" && this.queues.length === 1) ||
      this.queues.length === 0
    ) {
      this.originalQueue = "*";
      await this.untrack();
      const response = await this.connection.redis.smembers(
        this.connection.key("queues")
      );
      this.queues = response ? response.sort() : [];
      await this.track();
    }
  }

  private failurePayload(err, job) {
    return {
      worker: this.name,
      queue: this.queue,
      payload: job,
      exception: err.name,
      error: err.message,
      backtrace: err.stack ? err.stack.split("\n").slice(1) : null,
      failed_at: new Date().toString()
    };
  }

  private stringQueues() {
    if (this.queues.length === 0) {
      return ["*"].join(",");
    } else {
      try {
        return this.queues.join(",");
      } catch (e) {
        return "";
      }
    }
  }
}

exports.Worker = Worker;
