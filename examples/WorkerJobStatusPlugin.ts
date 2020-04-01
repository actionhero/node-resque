import { Worker } from "../src";
/* In your projects:
import { Worker } from "node-resque";
*/
/**
 * // Create worker object
 * const worker = new Worker(...);
 *
 * // Attach WorkerJobStatusPlugin events to worker
 * new WorkerJobStatusPlugin(worker);
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

  constructor(private readonly worker: Worker) {
    worker.on("success", async (...args) => {
      await this.onSuccess(...args);
    });
    worker.on("failure", async (...args) => {
      await this.onFailure(...args);
    });
    worker.on("job", async (...args) => {
      await this.onJob(...args);
    });
  }

  /**
   * Called when job is created
   */
  private async onJob(queue: string, job: any) {
    await this.update(job, this.STATUS_RUNNING);
  }

  private async onFailure(
    queue: string,
    job: any,
    failure: any,
    duration: number
  ) {
    await this.update(job, this.STATUS_FAILED);
  }

  private async onSuccess(
    queue: string,
    job: any,
    result: any,
    duration: number
  ) {
    await this.update(job, this.STATUS_COMPLETE, result);
  }

  private async update(job: any, status: number, result: any = null) {
    const packet = this.statusPacket(status, result);
    const statusKey = this.statusKey(job);

    await this.redis().set(statusKey, JSON.stringify(packet));
  }

  private redis() {
    return this.worker.connection.redis;
  }

  /**
   * @see https://github.com/resque/php-resque/blob/v1.3.4/lib/Resque/Job/Status.php#L186-L194
   */
  private statusKey(job: any): string {
    const key = `job:${job.prefix}${job.id}:status`;

    return this.worker.connection.key(key);
  }

  private statusPacket(status: number, result: any) {
    return {
      status: status,
      updated: +new Date() / 1000,
      result: result,
    };
  }
}
