import { Connection, MultiWorker, Worker } from "node-resque";
import { Job, JobEmit } from "node-resque/src/types/job";
import { ConnectionOptions } from "node-resque/src/types/options";

/**
 * Add Job status update plugin (php-resque way).
 *
 * Emits status messages that php-resque is able to monitor:
 * - https://github.com/resque/php-resque#tracking-job-statuses
 *
 * // Create worker object
 * const worker = new Worker(...);
 *
 * // Attach WorkerJobStatusPlugin events to worker
 * new WorkerJobStatusPlugin(worker, connectionDetails);
 *
 * @author Elan Ruusamäe <glen@pld-linux.org>
 */
export class WorkerJobStatusPlugin {
  /**
   * Status constants as of
   * @see https://github.com/resque/php-resque/blob/v1.3.4/lib/Resque/Job/Status.php#L11-L14
   */
  public STATUS_WAITING = 1;
  public STATUS_RUNNING = 2;
  public STATUS_FAILED = 3;
  public STATUS_COMPLETE = 4;

  private readonly connection: Connection;

  constructor(worker: Worker | MultiWorker, connection: ConnectionOptions) {
    if (worker instanceof Worker) {
      this.subscribeWorker(worker);
    } else if (worker instanceof MultiWorker) {
      this.subscribeMultiWorker(worker);
    } else {
      throw new Error("Unsupported worker");
    }

    this.connection = new Connection(connection);
    this.connection.on("error", (error) => {
      console.log(error);
    });
  }

  private subscribeWorker(worker: Worker) {
    worker.on("success", async (queue: string, job: any, result: any) => {
      await this.onSuccess(job, result);
    });
    worker.on("failure", async (queue: string, job: JobEmit, failure: any) => {
      await this.onFailure(job, failure);
    });
    worker.on("job", async (queue: string, job: Job<any> | JobEmit) => {
      await this.onJob(job);
    });
  }

  private subscribeMultiWorker(worker: MultiWorker) {
    worker.on(
      "success",
      async (workerId: number, queue: string, job: any, result: any) => {
        await this.onSuccess(job, result);
      }
    );
    worker.on(
      "failure",
      async (
        workerId: number,
        queue: string,
        job: Job<any> | JobEmit,
        failure: any
      ) => {
        await this.onFailure(job, failure);
      }
    );
    worker.on(
      "job",
      async (workerId: number, queue: string, job: Job<any> | JobEmit) => {
        await this.onJob(job);
      }
    );
  }

  /**
   * Called when job is created
   */
  private async onJob(job: any) {
    await this.update(job, this.STATUS_RUNNING);
  }

  private async onFailure(job: any, failure: Error) {
    await this.update(job, this.STATUS_FAILED, failure);
  }

  private async onSuccess(job: any, result: any) {
    await this.update(job, this.STATUS_COMPLETE, result);
  }

  private async update(job: any, status: number, result: any = null) {
    const packet = this.statusPacket(status, result);
    const statusKey = this.statusKey(job);

    await this.redisSet(statusKey, JSON.stringify(packet));
  }

  private async redisSet(key: string, value: string) {
    if (!this.connection.connected) {
      await this.connection.connect();
    }

    await this.connection.redis.set(key, value);
  }

  /**
   * @see https://github.com/resque/php-resque/blob/v1.3.4/lib/Resque/Job/Status.php#L186-L194
   */
  private statusKey(job: any): string {
    const key = `job:${job.prefix}${job.id}:status`;

    return this.connection.key(key);
  }

  private statusPacket(status: number, result: any) {
    return {
      status: status,
      updated: +new Date() / 1000,
      result: result,
    };
  }
}
