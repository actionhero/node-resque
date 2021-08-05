import specHelper from "../utils/specHelper";
import {
  Scheduler,
  Plugins,
  Queue,
  Worker,
  Job,
  ParsedFailedJobPayload,
} from "../../src";

let queue: Queue;
let scheduler: Scheduler;

const jobs: { [key: string]: Job<any> } = {
  brokenJob: {
    plugins: [Plugins.Retry],
    pluginOptions: {
      Retry: {
        retryLimit: 3,
        retryDelay: 100,
      },
    },
    perform: () => {
      throw new Error("BUSTED");
    },
  },
  happyJob: {
    plugins: [Plugins.Retry],
    pluginOptions: {
      Retry: {
        retryLimit: 3,
        retryDelay: 100,
      },
    },
    //@ts-ignore
    perform: () => {
      // no return
    },
  },
};

describe("plugins", () => {
  describe("retry", () => {
    beforeAll(async () => {
      await specHelper.connect();
      await specHelper.cleanup();
      queue = new Queue(
        {
          connection: specHelper.cleanConnectionDetails(),
          queue: [specHelper.queue],
        },
        jobs
      );
      scheduler = new Scheduler({
        connection: specHelper.cleanConnectionDetails(),
        timeout: specHelper.timeout,
      });
      await scheduler.connect();
      scheduler.start();
      await queue.connect();
    });

    afterAll(async () => {
      await scheduler.end();
      await queue.end();
      await specHelper.disconnect();
    });

    afterEach(async () => {
      await specHelper.cleanup();
    });

    test("will work fine with non-crashing jobs", async () => {
      await new Promise(async (resolve) => {
        await queue.enqueue(specHelper.queue, "happyJob", [1, 2]);
        const length = await queue.length(specHelper.queue);
        expect(length).toBe(1);

        const worker = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );

        worker.on("failure", () => {
          throw new Error("should not get here");
        });

        await worker.connect();

        worker.on("success", async () => {
          const length = await specHelper.redis.llen(
            `${specHelper.namespace}:failed`
          );
          expect(length).toBe(0);
          await worker.end();
          resolve(null);
        });

        worker.start();
      });
    });

    test("will retry the job n times before finally failing", async () => {
      await new Promise(async (resolve) => {
        await queue.enqueue(specHelper.queue, "brokenJob");
        const length = await queue.length(specHelper.queue);
        expect(length).toBe(1);

        let failButRetryCount = 0;
        let failureCount = 0;

        const worker = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );

        worker.on("success", () => {
          failButRetryCount++;
        });

        await worker.connect();

        worker.on("failure", async () => {
          failureCount++;
          expect(failButRetryCount).toBe(2);
          expect(failureCount).toBe(1);
          expect(failButRetryCount + failureCount).toBe(3);

          const length = await specHelper.redis.llen(
            `${specHelper.namespace}:failed`
          );
          expect(length).toBe(1);
          await worker.end();
          resolve(null);
        });

        worker.start();
      });
    });

    test("can have a retry count set", async () => {
      await new Promise(async (resolve) => {
        const customJobs = {
          jobWithRetryCount: {
            plugins: [Plugins.Retry],
            pluginOptions: {
              Retry: {
                retryLimit: 5,
                retryDelay: 100,
              },
            },
            perform: () => {
              throw new Error("BUSTED");
            },
          },
        };

        await queue.enqueue(specHelper.queue, "jobWithRetryCount", [1, 2]);
        const length = await queue.length(specHelper.queue);
        expect(length).toBe(1);

        let failButRetryCount = 0;
        let failureCount = 0;

        const worker = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          customJobs
        );

        worker.on("success", () => {
          failButRetryCount++;
        });

        await worker.connect();

        worker.on("failure", async () => {
          failureCount++;
          expect(failButRetryCount).toBe(4);
          expect(failureCount).toBe(1);
          expect(failButRetryCount + failureCount).toBe(5);

          const length = await specHelper.redis.llen(
            `${specHelper.namespace}:failed`
          );
          expect(length).toBe(1);
          await worker.end();
          resolve(null);
        });

        worker.start();
      });
    });

    test("can have custom retry times set", async () => {
      await new Promise(async (resolve) => {
        const customJobs = {
          //@ts-ignore
          jobWithBackoffStrategy: {
            plugins: [Plugins.Retry],
            pluginOptions: {
              Retry: {
                retryLimit: 5,
                backoffStrategy: [1, 2, 3, 4, 5],
              },
            },
            perform: function (a, b, callback) {
              callback(new Error("BUSTED"), null);
            },
          } as Job<any>,
        };

        await queue.enqueue(specHelper.queue, "jobWithBackoffStrategy", [1, 2]);
        const length = await queue.length(specHelper.queue);
        expect(length).toBe(1);

        let failButRetryCount = 0;
        let failureCount = 0;

        const worker = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          customJobs
        );

        worker.on("success", () => {
          failButRetryCount++;
        });

        await worker.connect();

        worker.on("failure", async () => {
          failureCount++;
          expect(failButRetryCount).toBe(4);
          expect(failureCount).toBe(1);
          expect(failButRetryCount + failureCount).toBe(5);

          const length = await specHelper.redis.llen(
            `${specHelper.namespace}:failed`
          );
          expect(length).toBe(1);
          await worker.end();
          resolve(null);
        });

        worker.start();
      });
    });

    test("when a job fails it should be re-enqueued (and not go to the failure queue)", async () => {
      await new Promise(async (resolve) => {
        await queue.enqueue(specHelper.queue, "brokenJob", [1, 2]);

        const worker = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );

        await worker.connect();
        worker.on("success", async () => {
          const timestamps = await queue.scheduledAt(
            specHelper.queue,
            "brokenJob",
            [1, 2]
          );
          expect(timestamps.length).toBe(1);
          const length = await specHelper.redis.llen(
            `${specHelper.namespace}:failed`
          );
          expect(length).toBe(0);
          await worker.end();
          resolve(null);
        });

        worker.start();
      });
    });

    test("will handle the stats properly for failing jobs", async () => {
      await new Promise(async (resolve) => {
        await queue.enqueue(specHelper.queue, "brokenJob", [1, 2]);

        const worker = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );

        await worker.connect();

        worker.on("success", async () => {
          const globalProcessed = await specHelper.redis.get(
            `${specHelper.namespace}:stat:processed`
          );
          const globalFailed = await specHelper.redis.get(
            `${specHelper.namespace}:stat:failed`
          );
          const workerProcessed = await specHelper.redis.get(
            `${specHelper.namespace}:stat:processed:${worker.name}`
          );
          const workerFailed = await specHelper.redis.get(
            `${specHelper.namespace}:stat:failed:${worker.name}`
          );
          expect(String(globalProcessed)).toBe("0");
          expect(String(globalFailed)).toBe("1");
          expect(String(workerProcessed)).toBe("0");
          expect(String(workerFailed)).toBe("1");
          await worker.end();
          resolve(null);
        });

        worker.start();
      });
    });

    test("will set the retry counter & retry data", async () => {
      await new Promise(async (resolve) => {
        await queue.enqueue(specHelper.queue, "brokenJob", [1, 2]);

        const worker = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );

        await worker.connect();
        worker.on("success", async () => {
          const retryAttempts = await specHelper.redis.get(
            `${specHelper.namespace}:resque-retry:brokenJob:1-2`
          );
          let failureData = await specHelper.redis.get(
            `${specHelper.namespace}:failure-resque-retry:brokenJob:1-2`
          );
          expect(String(retryAttempts)).toBe("0");
          const failure = JSON.parse(failureData) as ParsedFailedJobPayload;
          expect(failure.payload).toEqual([1, 2]);
          expect(failure.exception).toBe("Error: BUSTED");
          expect(failure.worker).toBe("brokenJob");
          expect(failure.queue).toBe("test_queue");
          await worker.end();
          resolve(null);
        });

        worker.start();
      });
    });
  });
});
