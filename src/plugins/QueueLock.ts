// If a job with the same name, queue, and args is already in the queue, do not enqueue it again

import { Plugin } from "..";

export class QueueLock extends Plugin {
  async beforeEnqueue() {
    const key = this.key();
    const now = Math.round(new Date().getTime() / 1000);
    const timeout = now + this.lockTimeout() + 1;
    const set = await this.queueObject.connection.redis.setnx(key, timeout);

    //@ts-ignore
    if (set === true || set === 1) {
      await this.queueObject.connection.redis.expire(key, this.lockTimeout());
      return true;
    }

    const redisTimeout = await this.queueObject.connection.redis.get(key);
    const redisTimeoutInt = parseInt(redisTimeout);
    if (now <= redisTimeoutInt) {
      return false;
    }

    await this.queueObject.connection.redis.set(key, timeout);
    await this.queueObject.connection.redis.expire(key, this.lockTimeout());
    return true;
  }

  async afterEnqueue() {
    return true;
  }

  async beforePerform() {
    const key = this.key();
    await this.queueObject.connection.redis.del(key);
    return true;
  }

  async afterPerform() {
    return true;
  }

  lockTimeout() {
    if (this.options.lockTimeout) {
      return this.options.lockTimeout;
    } else {
      return 3600; // in seconds
    }
  }

  key() {
    if (this.options.key) {
      return typeof this.options.key === "function"
        ? this.options.key.apply(this)
        : this.options.key;
    } else {
      const flattenedArgs = JSON.stringify(this.args);
      return this.queueObject.connection.key(
        "lock",
        this.func,
        this.queue,
        flattenedArgs
      );
    }
  }
}
