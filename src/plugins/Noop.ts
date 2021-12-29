import { Plugin } from "..";

export class Noop extends Plugin {
  async afterPerform() {
    if (this.worker.error) {
      if (typeof this.options.logger === "function") {
        this.options.logger(this.worker.error);
      } else {
        console.log(this.worker.error);
      }
      delete this.worker.error;
    }

    return true;
  }

  async beforeEnqueue() {
    return true;
  }

  async beforeDelayEnqueue() {
    return true;
  }

  async afterEnqueue() {
    return true;
  }

  async afterDelayEnqueue() {
    return true;
  }

  async beforePerform() {
    return true;
  }
}
