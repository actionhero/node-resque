import { Plugin } from "./../index";

export class Noop extends Plugin {
  afterPerform() {
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

  beforeEnqueue() {
    return true;
  }

  afterEnqueue() {
    return true;
  }

  beforePerform() {
    return true;
  }
}
