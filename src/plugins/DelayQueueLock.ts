// If a job with the same name, queue, and args is already in the delayed queue(s), do not enqueue it again

import { Plugin } from "./../index";

class DelayQueueLock extends Plugin {
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

  afterEnqueue() {
    return true;
  }

  beforePerform() {
    return true;
  }

  afterPerform() {
    return true;
  }
}

exports.DelayQueueLock = DelayQueueLock;
