// If a job with the same name, queue, and args is already in the delayed queue(s), do not enqueue it again

import { Plugin } from "..";

export class DelayQueueLock extends Plugin {
  async beforeEnqueue() {
    const timestamps = await this.queueObject.scheduledAt(
      this.queue,
      this.func,
      this.args
    );
    if (timestamps.length > 0) {
      return false;
    } else {
      return true;
    }
  }

  async afterEnqueue() {
    return true;
  }

  async beforePerform() {
    return true;
  }

  async afterPerform() {
    return true;
  }
}

exports.DelayQueueLock = DelayQueueLock;
