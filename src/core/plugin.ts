import { Worker } from "./worker";
import { Connection } from "./connection";
import { ParsedJob, Queue } from "./queue";
import { LockArgs, DeepMerge } from "../utils/functions";

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
    this.options = options;

    /**
     * Define a getter/setter here to keep the original
     * unsealed `args` argument in the local scope,
     * preventing it from being accessed or modified directly
     */
    Object.defineProperty(this, "args", {
      get() {
        return LockArgs(args);
      },
      set(newArgs) {
        args = DeepMerge(this.args, newArgs);
      },
    });

    if (this.worker && this.worker.queueObject) {
      this.queueObject = this.worker.queueObject;
    } else {
      this.queueObject = this.worker;
    }
  }

  abstract beforeEnqueue?(): Promise<boolean>;
  abstract beforeDelayEnqueue?(): Promise<boolean>;
  abstract afterEnqueue?(): Promise<boolean>;
  abstract afterDelayEnqueue?(): Promise<boolean>;
  abstract beforePerform?(): Promise<boolean>;
  abstract afterPerform?(): Promise<boolean>;
}
