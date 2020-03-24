import { EventEmitter } from "events";
import * as os from "os";
import { Worker } from "./worker";
import { Connection } from "./connection";
import { EventLoopDelay } from "./../utils/eventLoopDelay";
import { MultiWorkerOptions } from "../types/options";
import { Jobs } from "../types/jobs";
import { Job, JobEmit } from "../types/job";

export declare interface MultiWorker {
  options: MultiWorkerOptions;
  jobs: Jobs;
  workers: Array<Worker>;
  name: string;
  running: boolean;
  working: boolean;
  eventLoopBlocked: boolean;
  eventLoopDelay: number;
  eventLoopCheckCounter: number;
  stopInProcess: boolean;
  connection: Connection;
  checkTimer: NodeJS.Timeout;

  on(event: "start" | "end", cb: (workerId: number) => void): this;
  on(
    event: "cleaning_worker",
    cb: (workerId: number, worker: Worker, pid: number) => void
  ): this;
  on(event: "poll", cb: (workerId: number, queue: string) => void): this;
  on(event: "ping", cb: (workerId: number, time: number) => void): this;
  on(
    event: "job",
    cb: (workerId: number, queue: string, job: Job<any> | JobEmit) => void
  ): this;
  on(
    event: "reEnqueue",
    cb: (
      workerId: number,
      queue: string,
      job: Job<any> | JobEmit,
      plugin: string
    ) => void
  ): this;
  on(
    event: "success",
    cb: (
      workerId: number,
      queue: string,
      job: Job<any> | JobEmit,
      result: any,
      duration: number
    ) => void
  ): this;
  on(
    event: "failure",
    cb: (
      workerId: number,
      queue: string,
      job: Job<any> | JobEmit,
      failure: any,
      duration: number
    ) => void
  ): this;
  on(
    event: "error",
    cb: (
      workerId: number,
      queue: string,
      job: Job<any> | JobEmit,
      error: any
    ) => void
  ): this;
  on(event: "pause", cb: (workerId: number) => void): this;
  on(
    event: "multiWorkerAction",
    cb: (verb: string, delay: number) => void
  ): this;
}

export class MultiWorker extends EventEmitter {
  constructor(options, jobs) {
    super();

    const defaults = {
      // all times in ms
      minTaskProcessors: 1,
      maxTaskProcessors: 10,
      timeout: 5000,
      checkTimeout: 500,
      maxEventLoopDelay: 10,
      name: os.hostname(),
    };

    for (const i in defaults) {
      if (options[i] === null || options[i] === undefined) {
        options[i] = defaults[i];
      }
    }

    if (
      options.connection.redis &&
      typeof options.connection.redis.setMaxListeners === "function"
    ) {
      options.connection.redis.setMaxListeners(
        options.connection.redis.getMaxListeners() + options.maxTaskProcessors
      );
    }

    this.workers = [];
    this.options = options;
    this.jobs = jobs;
    this.running = false;
    this.working = false;
    this.name = this.options.name;
    this.eventLoopBlocked = true;
    this.eventLoopDelay = Infinity;
    this.eventLoopCheckCounter = 0;
    this.stopInProcess = false;
    this.checkTimer = null;

    this.PollEventLoopDelay();
  }

  private PollEventLoopDelay() {
    EventLoopDelay(
      this.options.maxEventLoopDelay,
      this.options.checkTimeout,
      (blocked, ms) => {
        this.eventLoopBlocked = blocked;
        this.eventLoopDelay = ms;
        this.eventLoopCheckCounter++;
      }
    );
  }

  private async startWorker() {
    const id = this.workers.length + 1;

    const worker = new Worker(
      {
        connection: this.options.connection,
        queues: this.options.queues,
        timeout: this.options.timeout,
        name: this.options.name + ":" + process.pid + "+" + id,
      },
      this.jobs
    );

    worker.id = id;

    worker.on("start", () => {
      this.emit("start", worker.id);
    });
    worker.on("end", () => {
      this.emit("end", worker.id);
    });
    worker.on("cleaning_worker", (worker, pid) => {
      this.emit("cleaning_worker", worker.id, worker, pid);
    });
    worker.on("poll", (queue) => {
      this.emit("poll", worker.id, queue);
    });
    worker.on("ping", (time) => {
      this.emit("ping", worker.id, time);
    });
    worker.on("job", (queue, job) => {
      this.emit("job", worker.id, queue, job);
    });
    worker.on("reEnqueue", (queue, job, plugin) => {
      this.emit("reEnqueue", worker.id, queue, job, plugin);
    });
    worker.on("success", (queue, job, result, duration) => {
      this.emit("success", worker.id, queue, job, result, duration);
    });
    worker.on("failure", (queue, job, failure, duration) => {
      this.emit("failure", worker.id, queue, job, failure, duration);
    });
    worker.on("error", (error, queue, job) => {
      this.emit("error", error, worker.id, queue, job);
    });
    worker.on("pause", () => {
      this.emit("pause", worker.id);
    });

    this.workers.push(worker);

    await worker.connect();
    await worker.start();
  }

  private async checkWorkers() {
    let verb;
    let worker;
    let workingCount = 0;

    this.workers.forEach((worker) => {
      if (worker.working === true) {
        workingCount++;
      }
    });

    this.working = false;
    if (workingCount > 0) {
      this.working = true;
    }

    if (this.running === false && this.workers.length > 0) {
      verb = "--";
    } else if (this.running === false && this.workers.length === 0) {
      verb = "x";
    } else if (
      this.eventLoopBlocked &&
      this.workers.length > this.options.minTaskProcessors
    ) {
      verb = "-";
    } else if (
      this.eventLoopBlocked &&
      this.workers.length === this.options.minTaskProcessors
    ) {
      verb = "x";
    } else if (
      !this.eventLoopBlocked &&
      this.workers.length < this.options.minTaskProcessors
    ) {
      verb = "+";
    } else if (
      !this.eventLoopBlocked &&
      this.workers.length < this.options.maxTaskProcessors &&
      (this.workers.length === 0 || workingCount / this.workers.length > 0.5)
    ) {
      verb = "+";
    } else if (
      !this.eventLoopBlocked &&
      this.workers.length > this.options.minTaskProcessors &&
      workingCount / this.workers.length < 0.5
    ) {
      verb = "-";
    } else {
      verb = "x";
    }

    if (verb === "x") {
      return { verb, eventLoopDelay: this.eventLoopDelay };
    }

    if (verb === "-") {
      worker = this.workers.pop();
      await worker.end();
      await this.cleanupWorker(worker);
      return { verb, eventLoopDelay: this.eventLoopDelay };
    }

    if (verb === "--") {
      this.stopInProcess = true;

      const promises = [];
      this.workers.forEach((worker) => {
        promises.push(
          new Promise(async (resolve) => {
            await worker.end();
            await this.cleanupWorker(worker);
            return resolve();
          })
        );
      });

      await Promise.all(promises);

      this.stopInProcess = false;
      this.workers = [];
      return { verb, eventLoopDelay: this.eventLoopDelay };
    }

    if (verb === "+") {
      await this.startWorker();
      return { verb, eventLoopDelay: this.eventLoopDelay };
    }
  }

  private async cleanupWorker(worker) {
    [
      "start",
      "end",
      "cleaning_worker",
      "poll",
      "ping",
      "job",
      "reEnqueue",
      "success",
      "failure",
      "error",
      "pause",
      "internalError",
      "multiWorkerAction",
    ].forEach(function (e) {
      worker.removeAllListeners(e);
    });
  }

  private async checkWraper() {
    clearTimeout(this.checkTimer);
    const { verb, eventLoopDelay } = await this.checkWorkers();
    this.emit("multiWorkerAction", verb, eventLoopDelay);
    this.checkTimer = setTimeout(() => {
      this.checkWraper();
    }, this.options.checkTimeout);
  }

  start() {
    this.running = true;
    this.checkWraper();
  }

  async stop() {
    this.running = false;
    await this.stopWait();
  }

  async end() {
    return this.stop();
  }

  private async stopWait() {
    if (
      this.workers.length === 0 &&
      this.working === false &&
      !this.stopInProcess
    ) {
      clearTimeout(this.checkTimer);
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, this.options.checkTimeout);
    });
    return this.stopWait();
  }
}
