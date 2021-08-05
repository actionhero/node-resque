// If a job with the same name, queue, and args is already running, put this job back in the queue and try later
import { Plugin } from "..";

export class JobLock extends Plugin {
  async beforeEnqueue() {
    return true;
  }

  async afterEnqueue() {
    return true;
  }

  async beforePerform() {
    const key = this.key();
    const now = Math.round(new Date().getTime() / 1000);
    const timeout = now + this.lockTimeout() + 1;

    const lockedByMe = await this.queueObject.connection.redis.set(
      key,
      timeout,
      "NX",
      "EX",
      this.lockTimeout()
    );
    if (lockedByMe && lockedByMe.toString().toLowerCase() === "ok") {
      return true;
    } else {
      const options = this.job.pluginOptions;
      const toReEnqueue = options.JobLock
        ? options.JobLock.reEnqueue !== null &&
          options.JobLock.reEnqueue !== undefined
          ? options.JobLock.reEnqueue
          : true
        : true;

      if (toReEnqueue) await this.reEnqueue();
      return false;
    }
  }

  async afterPerform() {
    const key = this.key();
    await this.queueObject.connection.redis.del(key);
    return true;
  }

  async reEnqueue() {
    await this.queueObject.enqueueIn(
      this.enqueueTimeout(),
      this.queue,
      this.func,
      this.args
    );
  }

  lockTimeout() {
    if (this.options.lockTimeout) {
      return this.options.lockTimeout;
    } else {
      return 3600; // in seconds
    }
  }

  enqueueTimeout() {
    if (this.options.enqueueTimeout) {
      return this.options.enqueueTimeout;
    } else {
      return 1001; // in ms
    }
  }

  key() {
    if (this.options.key) {
      return typeof this.options.key === "function"
        ? this.options.key.apply(this)
        : this.options.key;
    } else {
      const flattenedArgs = JSON.stringify(this.args);
      return this.worker.connection.key(
        "workerslock",
        this.func,
        this.queue,
        flattenedArgs
      );
    }
  }
}
