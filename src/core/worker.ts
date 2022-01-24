import { EventEmitter } from "events";
import { Cluster } from "ioredis";
import * as os from "os";
import { Jobs } from "..";
import { WorkerOptions } from "../types/options";
import { Connection } from "./connection";
import { RunPlugins } from "./pluginRunner";
import { ParsedJob, Queue } from "./queue";

function prepareJobs(jobs: Jobs) {
  return Object.keys(jobs).reduce((h: { [key: string]: any }, k) => {
    const job = jobs[k];
    h[k] = typeof job === "function" ? { perform: job } : job;
    return h;
  }, {});
}

export declare interface Worker {
  options: WorkerOptions;
  jobs: Jobs;
  started: boolean;
  name: string;
  queues: Array<string> | string;
  queue: string;
  originalQueue: string | null;
  error: Error | null;
  result: any;
  ready: boolean;
  running: boolean;
  working: boolean;
  pollTimer: NodeJS.Timeout;
  endTimer: NodeJS.Timeout;
  pingTimer: NodeJS.Timeout;
  job: ParsedJob;
  connection: Connection;
  queueObject: Queue;
  id: number;

  on(event: "start" | "end" | "pause", cb: () => void): this;
  on(event: "cleaning_worker", cb: (worker: Worker, pid: string) => void): this;
  on(event: "poll", cb: (queue: string) => void): this;
  on(event: "ping", cb: (time: number) => void): this;
  on(event: "job", cb: (queue: string, job: ParsedJob) => void): this;
  on(
    event: "reEnqueue",
    cb: (queue: string, job: ParsedJob, plugin: string) => void
  ): this;
  on(
    event: "success",
    cb: (queue: string, job: ParsedJob, result: any, duration: number) => void
  ): this;
  on(
    event: "failure",
    cb: (
      queue: string,
      job: ParsedJob,
      failure: Error,
      duration: number
    ) => void
  ): this;
  on(
    event: "error",
    cb: (error: Error, queue: string, job: ParsedJob) => void
  ): this;

  once(event: "start" | "end" | "pause", cb: () => void): this;
  once(
    event: "cleaning_worker",
    cb: (worker: Worker, pid: string) => void
  ): this;
  once(event: "poll", cb: (queue: string) => void): this;
  once(event: "ping", cb: (time: number) => void): this;
  once(event: "job", cb: (queue: string, job: ParsedJob) => void): this;
  once(
    event: "reEnqueue",
    cb: (queue: string, job: ParsedJob, plugin: string) => void
  ): this;
  once(
    event: "success",
    cb: (queue: string, job: ParsedJob, result: any) => void
  ): this;
  once(
    event: "failure",
    cb: (queue: string, job: ParsedJob, failure: any) => void
  ): this;
  once(
    event: "error",
    cb: (error: Error, queue: string, job: ParsedJob) => void
  ): this;

  removeAllListeners(event: string): this;
}

export type WorkerEvent =
  | "start"
  | "end"
  | "cleaning_worker"
  | "poll"
  | "ping"
  | "job"
  | "reEnqueue"
  | "success"
  | "failure"
  | "error"
  | "pause";

export class Worker extends EventEmitter {
  constructor(options: WorkerOptions, jobs: Jobs = {}) {
    super();

    options.name = options.name ?? os.hostname() + ":" + process.pid; // assumes only one worker per node process
    options.id = options.id ?? 1;
    options.queues = options.queues ?? "*";
    options.timeout = options.timeout ?? 5000;
    options.looping = options.looping ?? true;

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
    this.pollTimer = null;
    this.endTimer = null;
    this.pingTimer = null;
    this.started = false;

    this.queueObject = new Queue({ connection: options.connection }, this.jobs);
    this.queueObject.on("error", (error) => {
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

  async init() {
    await this.track();
    await this.connection.redis.set(
      this.connection.key("worker", this.name, this.stringQueues(), "started"),
      Math.round(new Date().getTime() / 1000)
    );
    await this.ping();
    this.pingTimer = setInterval(this.ping.bind(this), this.options.timeout);
  }

  async end(): Promise<void> {
    this.running = false;

    if (this.working === true) {
      await new Promise((resolve) => {
        this.endTimer = setTimeout(() => {
          resolve(null);
        }, this.options.timeout);
      });
      return this.end();
    }

    clearTimeout(this.pollTimer);
    clearTimeout(this.endTimer);
    clearInterval(this.pingTimer);

    if (
      this.connection &&
      (this.connection.connected === true ||
        this.connection.connected === undefined ||
        this.connection.connected === null)
    ) {
      await this.untrack();
    }

    await this.queueObject.end();
    this.emit("end", new Date());
  }

  private async poll(nQueue = 0): Promise<ParsedJob> {
    if (!this.running) return;

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
      const currentJob = await this.getJob();
      if (currentJob) {
        if (this.options.looping) {
          this.result = null;
          await this.perform(currentJob);
        } else {
          return currentJob;
        }
      } else {
        this.working = false;
        if (nQueue === this.queues.length - 1) {
          if (this.originalQueue === "*") await this.checkQueues();
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

  private async perform(job: ParsedJob) {
    this.job = job;
    this.error = null;
    let toRun;
    const startedAt = new Date().getTime();

    if (!this.jobs[job.class]) {
      this.error = new Error(`No job defined for class "${job.class}"`);
      return this.completeJob(false, startedAt);
    }

    const perform = this.jobs[job.class].perform;
    if (!perform || typeof perform !== "function") {
      this.error = new Error(`Missing Job: "${job.class}"`);
      return this.completeJob(false, startedAt);
    }
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
        return this.completeJob(false, startedAt);
      }

      let callableArgs = [job.args];
      if (job.args === undefined || job.args instanceof Array) {
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
      return this.completeJob(true, startedAt);
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
      return this.completeJob(!this.error, startedAt);
    }
  }

  // #performInline is used to run a job payload directly.
  // If you are planning on running a job via #performInline, this worker should also not be started, nor should be using event emitters to monitor this worker.
  // This method will also not write to redis at all, including logging errors, modify resque's stats, etc.
  async performInline(func: string, args: any[] = []) {
    const q = "_direct-queue-" + this.name;
    let toRun;

    if (!(args instanceof Array)) {
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

  private async completeJob(toRespond: boolean, startedAt: number) {
    const duration = new Date().getTime() - startedAt;
    if (this.error) {
      await this.fail(this.error, duration);
    } else if (toRespond) {
      await this.succeed(this.job, duration);
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

  private async succeed(job: ParsedJob, duration: number) {
    await this.connection.redis
      .multi()
      .incr(this.connection.key("stat", "processed"))
      .incr(this.connection.key("stat", "processed", this.name))
      .exec();
    this.emit("success", this.queue, job, this.result, duration);
  }

  private async fail(err: Error, duration: number) {
    await this.connection.redis
      .multi()
      .incr(this.connection.key("stat", "failed"))
      .incr(this.connection.key("stat", "failed", this.name))
      .rpush(
        this.connection.key("failed"),
        JSON.stringify(this.failurePayload(err, this.job))
      )
      .exec();
    this.emit("failure", this.queue, this.job, err, duration);
  }

  private async pause() {
    this.emit("pause");
    await new Promise((resolve) => {
      this.pollTimer = setTimeout(() => {
        this.poll();
        resolve(null);
      }, this.options.timeout);
    });
  }

  private async getJob() {
    let currentJob: ParsedJob;
    const queueKey = this.connection.key("queue", this.queue);
    const workerKey = this.connection.key(
      "worker",
      this.name,
      this.stringQueues()
    );

    let encodedJob: string;

    if (
      // We cannot use the atomic Lua script if we are using redis cluster - the shard storing the queue and worker may not be the same
      !(this.connection.redis instanceof Cluster) &&
      //@ts-ignore
      this.connection.redis["popAndStoreJob"]
    ) {
      //@ts-ignore
      encodedJob = await this.connection.redis["popAndStoreJob"](
        queueKey,
        workerKey,
        new Date().toString(),
        this.queue,
        this.name
      );
    } else {
      encodedJob = await this.connection.redis.lpop(queueKey);
      if (encodedJob) {
        await this.connection.redis.set(
          workerKey,
          JSON.stringify({
            run_at: new Date().toString(),
            queue: this.queue,
            worker: this.name,
            payload: JSON.parse(encodedJob),
          })
        );
      }
    }

    if (encodedJob) currentJob = JSON.parse(encodedJob);

    return currentJob;
  }

  private async track() {
    this.running = true;
    return this.connection.redis.sadd(
      this.connection.key("workers"),
      this.name + ":" + this.stringQueues()
    );
  }

  private async ping() {
    if (!this.running) return;

    const name = this.name;
    const nowSeconds = Math.round(new Date().getTime() / 1000);
    this.emit("ping", nowSeconds);
    const payload = JSON.stringify({
      time: nowSeconds,
      name: name,
      queues: this.stringQueues(),
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

    await this.connection.redis
      .multi()
      .srem(this.connection.key("workers"), name + ":" + queues)
      .del(this.connection.key("worker", "ping", name))
      .del(this.connection.key("worker", name, queues))
      .del(this.connection.key("worker", name, queues, "started"))
      .del(this.connection.key("stat", "failed", name))
      .del(this.connection.key("stat", "processed", name))
      .exec();
  }

  async checkQueues() {
    if (Array.isArray(this.queues) && this.queues.length > 0) {
      this.ready = true;
    }

    if (
      (this.queues[0] === "*" && this.queues.length === 1) ||
      this.queues.length === 0 ||
      this.originalQueue === "*"
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

  private failurePayload(err: Error, job: ParsedJob) {
    return {
      worker: this.name,
      queue: this.queue,
      payload: job,
      exception: err.name,
      error: err.message,
      backtrace: err.stack ? err.stack.split("\n").slice(1) : null,
      failed_at: new Date().toString(),
    };
  }

  private stringQueues() {
    if (this.queues.length === 0) {
      return ["*"].join(",");
    } else {
      try {
        return Array.isArray(this.queues) ? this.queues.join(",") : this.queues;
      } catch (e) {
        return "";
      }
    }
  }
}

exports.Worker = Worker;
