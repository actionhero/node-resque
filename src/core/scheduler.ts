// To read notes about the leader locking scheme, check out:
//   https://github.com/resque/resque-scheduler/blob/master/lib/resque/scheduler/locking.rb

import { EventEmitter } from "events";
import * as os from "os";
import { ErrorPayload } from "../types/errorPayload";
import { Job } from "../types/job";
import { Jobs } from "../types/jobs";
import { SchedulerOptions } from "../types/options";
import { Connection } from "./connection";
import { Queue } from "./queue";

export declare interface Scheduler {
  options: SchedulerOptions;
  jobs: Jobs;
  name: string;
  leader: boolean;
  running: boolean;
  processing: boolean;
  queue: Queue;
  connection: Connection;
  timer: NodeJS.Timeout;

  on(event: "start" | "end" | "poll" | "leader", cb: () => void): this;
  on(
    event: "cleanStuckWorker",
    cb: (workerName: string, errorPayload: ErrorPayload, delta: number) => void
  ): this;
  on(event: "error", cb: (error: Error, queue: string) => void): this;
  on(event: "workingTimestamp", cb: (timestamp: number) => void): this;
  on(
    event: "transferredJob",
    cb: (timestamp: number, job: Job<any>) => void
  ): this;

  once(event: "start" | "end" | "poll" | "leader", cb: () => void): this;
  once(
    event: "cleanStuckWorker",
    cb: (workerName: string, errorPayload: ErrorPayload, delta: number) => void
  ): this;
  once(event: "error", cb: (error: Error, queue: string) => void): this;
  once(event: "workingTimestamp", cb: (timestamp: number) => void): this;
  once(
    event: "transferredJob",
    cb: (timestamp: number, job: Job<any>) => void
  ): this;

  removeAllListeners(event: SchedulerEvent): this;
}

export type SchedulerEvent =
  | "start"
  | "end"
  | "poll"
  | "leader"
  | "cleanStuckWorker"
  | "error"
  | "workingTimestamp"
  | "transferredJob";

export class Scheduler extends EventEmitter {
  constructor(options, jobs = {}) {
    super();

    const defaults = {
      timeout: 5000, // in ms
      stuckWorkerTimeout: 60 * 60 * 1000, // 60 minutes in ms
      leaderLockTimeout: 60 * 3, // in seconds
      name: os.hostname() + ":" + process.pid, // assumes only one worker per node process
    };

    for (const i in defaults) {
      if (options[i] === null || options[i] === undefined) {
        options[i] = defaults[i];
      }
    }

    this.options = options;
    this.name = this.options.name;
    this.leader = false;
    this.running = false;
    this.processing = false;

    this.queue = new Queue({ connection: options.connection }, jobs);
    this.queue.on("error", (error) => {
      this.emit("error", error);
    });
  }

  async connect() {
    await this.queue.connect();
    this.connection = this.queue.connection;
  }

  async start() {
    this.processing = false;

    if (!this.running) {
      this.emit("start");
      this.running = true;
      this.pollAgainLater();
    }
  }

  async end() {
    this.running = false;
    clearTimeout(this.timer);

    if (this.processing === false) {
      if (
        this.connection &&
        (this.connection.connected === true ||
          this.connection.connected === undefined ||
          this.connection.connected === null)
      ) {
        try {
          await this.releaseLeaderLock();
        } catch (error) {
          this.emit("error", error);
        }
      }

      try {
        await this.queue.end();
        this.emit("end");
      } catch (error) {
        this.emit("error", error);
      }
    } else {
      return new Promise((resolve) => {
        setTimeout(async () => {
          await this.end();
          resolve();
        }, this.options.timeout / 2);
      });
    }
  }

  async poll() {
    this.processing = true;
    clearTimeout(this.timer);
    const isLeader = await this.tryForLeader();

    if (!isLeader) {
      this.leader = false;
      this.processing = false;
      return this.pollAgainLater();
    }

    if (!this.leader) {
      this.leader = true;
      this.emit("leader");
    }

    this.emit("poll");
    const timestamp = await this.nextDelayedTimestamp();
    if (timestamp) {
      this.emit("workingTimestamp", timestamp);
      await this.enqueueDelayedItemsForTimestamp(parseInt(timestamp));
      return this.poll();
    } else {
      await this.checkStuckWorkers();
      this.processing = false;
      return this.pollAgainLater();
    }
  }

  private async pollAgainLater() {
    if (this.running === true) {
      this.timer = setTimeout(() => {
        this.poll();
      }, this.options.timeout);
    }
  }

  private leaderKey() {
    // TODO: Figure out if more work is needed
    // return this.connection.key("resque_scheduler_master_lock");
    return this.connection.key("resque_scheduler_leader_lock");
  }

  private async tryForLeader() {
    const leaderKey = this.leaderKey();
    if (!this.connection || !this.connection.redis) {
      return;
    }

    const lockedByMe = await this.connection.redis.set(
      leaderKey,
      this.options.name,
      "NX",
      "EX",
      this.options.leaderLockTimeout
    );

    if (lockedByMe && lockedByMe.toLowerCase() === "ok") {
      return true;
    }

    const currentLeaderName = await this.connection.redis.get(leaderKey);
    if (currentLeaderName === this.options.name) {
      await this.connection.redis.expire(
        leaderKey,
        this.options.leaderLockTimeout
      );
      return true;
    }

    return false;
  }

  private async releaseLeaderLock() {
    if (!this.connection || !this.connection.redis) {
      return;
    }

    const isLeader = await this.tryForLeader();
    if (!isLeader) {
      return false;
    }

    const deleted = await this.connection.redis.del(this.leaderKey());
    this.leader = false;
    return deleted === 1 || deleted.toString() === "true";
  }

  private async nextDelayedTimestamp() {
    const time = Math.round(new Date().getTime() / 1000);
    const items = await this.connection.redis.zrangebyscore(
      this.connection.key("delayed_queue_schedule"),
      0,
      time,
      "LIMIT",
      0,
      1
    );
    if (items.length === 0) {
      return;
    }
    return items[0];
  }

  private async enqueueDelayedItemsForTimestamp(timestamp: number) {
    const job = await this.nextItemForTimestamp(timestamp);
    if (job) {
      await this.transfer(timestamp, job);
      await this.enqueueDelayedItemsForTimestamp(timestamp);
    } else {
      await this.cleanupTimestamp(timestamp);
    }
  }

  private async nextItemForTimestamp(timestamp: number) {
    const key = this.connection.key("delayed:" + timestamp);
    const job = await this.connection.redis.lpop(key);
    await this.connection.redis.srem(
      this.connection.key("timestamps:" + job),
      "delayed:" + timestamp
    );
    return JSON.parse(job);
  }

  private async transfer(timestamp: number, job: any) {
    await this.queue.enqueue(job.queue, job.class, job.args);
    this.emit("transferredJob", timestamp, job);
  }

  private async cleanupTimestamp(timestamp: number) {
    const key = this.connection.key("delayed:" + timestamp);
    await this.connection.redis.watch(key);
    await this.connection.redis.watch(
      this.connection.key("delayed_queue_schedule")
    );
    const length = await this.connection.redis.llen(key);
    if (length === 0) {
      await this.connection.redis
        .multi()
        .del(key)
        .zrem(this.connection.key("delayed_queue_schedule"), timestamp)
        .exec();
    }
    await this.connection.redis.unwatch();
  }

  private async checkStuckWorkers() {
    interface Payload {
      time: number;
      name: string;
    }

    if (!this.options.stuckWorkerTimeout) {
      return;
    }

    const keys = await this.connection.getKeys(
      this.connection.key("worker", "ping", "*")
    );
    const payloads: Array<Payload> = await Promise.all(
      keys.map(async (k) => {
        return JSON.parse(await this.connection.redis.get(k));
      })
    );

    const nowInSeconds = Math.round(new Date().getTime() / 1000);
    const stuckWorkerTimeoutInSeconds = Math.round(
      this.options.stuckWorkerTimeout / 1000
    );

    for (let i in payloads) {
      if (!payloads[i]) continue;
      const { name, time } = payloads[i];
      const delta = nowInSeconds - time;
      if (delta > stuckWorkerTimeoutInSeconds) {
        await this.forceCleanWorker(name, delta);
      }
    }
  }

  async forceCleanWorker(workerName, delta) {
    const errorPayload = await this.queue.forceCleanWorker(workerName);
    this.emit("cleanStuckWorker", workerName, errorPayload, delta);
  }
}
