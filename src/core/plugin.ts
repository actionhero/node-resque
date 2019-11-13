import { Worker } from "./worker";
import { Connection } from "./connection";
import { Queue } from "./queue";

export abstract class Plugin {
  name: string;
  worker: Connection | Worker | any;
  queueObject: Queue;
  queue: string;
  func: string;
  job: {
    [key: string]: any;
  };
  args: Array<any>;
  options: {
    [key: string]: any;
  };

  constructor(worker, func, queue, job, args, options) {
    this.name = "CustomPlugin";
    this.worker = worker;
    this.queue = queue;
    this.func = func;
    this.job = job;
    this.args = args;
    this.options = options;

    if (this.worker && this.worker.queueObject) {
      this.queueObject = this.worker.queueObject;
    } else {
      this.queueObject = this.worker;
    }
  }

  abstract beforeEnqueue?(): void;
  abstract afterEnqueue?(): void;
  abstract beforePerform?(): void;
  abstract afterPerform?(): void;
}
