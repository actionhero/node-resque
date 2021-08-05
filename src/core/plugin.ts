import { Worker } from "./worker";
import { Connection } from "./connection";
import { ParsedJob, Queue } from "./queue";

export abstract class Plugin {
  name: string;
  worker: Connection | Worker | any;
  queueObject: Queue;
  queue: string;
  func: string;
  job: ParsedJob;
  args: Array<any>;
  options: {
    [key: string]: any;
  };

  constructor(
    worker: Queue | Worker,
    func: string,
    queue: string,
    job: ParsedJob,
    args: Array<any>,
    options: {
      [key: string]: any;
    }
  ) {
    this.name = this?.constructor?.name || "Node Resque Plugin";
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

  abstract beforeEnqueue?(): Promise<boolean>;
  abstract afterEnqueue?(): Promise<boolean>;
  abstract beforePerform?(): Promise<boolean>;
  abstract afterPerform?(): Promise<boolean>;
}
