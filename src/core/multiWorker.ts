import { EventEmitter } from "events";
import * as os from "os";
import { Worker } from "./worker";
import { EventLoopDelay } from "../utils/eventLoopDelay";
import { MultiWorkerOptions } from "../types/options";
import { Jobs } from "..";
import { ParsedJob } from "./queue";

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
    cb: (workerId: number, queue: string, job: ParsedJob) => void
  ): this;
  on(
    event: "reEnqueue",
    cb: (
      workerId: number,
      queue: string,
      job: ParsedJob,
      plugin: string
    ) => void
  ): this;
  on(
    event: "success",
    cb: (
      workerId: number,
      queue: string,
      job: ParsedJob,
      result: any,
      duration: number
    ) => void
  ): this;
  on(
    event: "failure",
    cb: (
      workerId: number,
      queue: string,
      job: ParsedJob,
      failure: Error,
      duration: number
    ) => void
  ): this;
  on(
    event: "error",
    cb: (error: Error, workerId: number, queue: string, job: ParsedJob) => void
  ): this;
  on(event: "pause", cb: (workerId: number) => void): this;
  on(
    event: "multiWorkerAction",
    cb: (verb: string, delay: number) => void
  ): this;
}

export class MultiWorker extends EventEmitter {
  constructor(options: MultiWorkerOptions, jobs: Jobs) {
    super();

    options.name = options.name ?? os.hostname();
    options.minTaskProcessors = options.minTaskProcessors ?? 1;
    options.maxTaskProcessors = options.maxTaskProcessors ?? 10;
    options.timeout = options.timeout ?? 5000;
    options.checkTimeout = options.checkTimeout ?? 500;
    options.maxEventLoopDelay = options.maxEventLoopDelay ?? 10;

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
      (blocked: boolean, ms: number) => {
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

    this.working = workingCount > 0;

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

      const promises: Promise<unknown>[] = [];
      this.workers.forEach((worker) => {
        promises.push(
          new Promise(async (resolve) => {
            await worker.end();
            await this.cleanupWorker(worker);
            return resolve(null);
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

  private async cleanupWorker(worker: Worker) {
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
      "multiWorkerAction",
    ].forEach((e) => {
      worker.removeAllListeners(e);
    });
  }

  private async checkWrapper() {
    clearTimeout(this.checkTimer);
    const { verb, eventLoopDelay } = await this.checkWorkers();
    this.emit("multiWorkerAction", verb, eventLoopDelay);
    this.checkTimer = setTimeout(() => {
      this.checkWrapper();
    }, this.options.checkTimeout);
  }

  start() {
    this.running = true;
    this.checkWrapper();
  }

  async stop() {
    this.running = false;
    await this.stopWait();
  }

  async end() {
    return this.stop();
  }

  private async stopWait(): Promise<void> {
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
