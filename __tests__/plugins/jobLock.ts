import specHelper from "../utils/specHelper";
import { Queue, Plugins, Worker, ParsedJob, Job } from "../../src";

let queue: Queue;
const jobDelay = 1000;
let worker1: Worker;
let worker2: Worker;

const jobs = {
  slowAdd: {
    plugins: [Plugins.JobLock],
    pluginOptions: { jobLock: {} },
    perform: async (a: number, b: number) => {
      const answer = a + b;
      await new Promise((resolve) => {
        setTimeout(resolve, jobDelay);
      });
      return answer;
    },
  },
  withoutReEnqueue: {
    plugins: [Plugins.JobLock],
    pluginOptions: { JobLock: { reEnqueue: false } },
    perform: async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, jobDelay);
      });
    },
  },
};

describe("plugins", () => {
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
    await queue.connect();
  });

  afterEach(async () => {
    await specHelper.cleanup();
  });

  afterAll(async () => {
    await queue.end();
    await specHelper.disconnect();
  });

  describe("jobLock", () => {
    test("will not lock jobs since arg objects are different", async () => {
      worker1 = new Worker(
        {
          connection: specHelper.cleanConnectionDetails(),
          timeout: specHelper.timeout,
          queues: [specHelper.queue],
        },
        jobs
      );
      worker2 = new Worker(
        {
          connection: specHelper.cleanConnectionDetails(),
          timeout: specHelper.timeout,
          queues: [specHelper.queue],
        },
        jobs
      );

      worker1.on("error", (error) => {
        throw error;
      });
      worker2.on("error", (error) => {
        throw error;
      });

      await worker1.connect();
      await worker2.connect();

      await new Promise((resolve) => {
        const startTime = new Date().getTime();
        let completed = 0;

        const onComplete = function () {
          completed++;
          if (completed === 2) {
            worker1.end();
            worker2.end();
            expect(new Date().getTime() - startTime).toBeLessThan(jobDelay * 3);
            resolve(null);
          }
        };

        worker1.on("success", onComplete);
        worker2.on("success", onComplete);

        queue.enqueue(specHelper.queue, "slowAdd", [
          { name: "Walter White" },
          2,
        ]);
        queue.enqueue(specHelper.queue, "slowAdd", [
          { name: "Jesse Pinkman" },
          2,
        ]);

        worker1.start();
        worker2.start();
      });
    });

    test("allows the key to be specified as a function", async () => {
      await new Promise(async (resolve) => {
        let calls = 0;

        const functionJobs = {
          //@ts-ignore
          jobLockAdd: {
            plugins: [Plugins.JobLock],
            pluginOptions: {
              JobLock: {
                key: function () {
                  // Once to create, once to delete
                  if (++calls === 2) {
                    worker1.end();
                    resolve(null);
                  }
                  const key = this.worker.connection.key(
                    "customKey",
                    Math.max.apply(Math.max, this.args)
                  );
                  return key;
                },
              },
            },
            perform: (a: number, b: number) => {
              return a + b;
            },
          } as Job<any>,
        };

        worker1 = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          functionJobs
        );
        worker1.on("error", (error) => {
          throw error;
        });
        await worker1.connect();
        await queue.enqueue(specHelper.queue, "jobLockAdd", [1, 2]);
        worker1.start();
      });
    });

    test("will not run 2 jobs with the same args at the same time", async () => {
      await new Promise(async (resolve) => {
        let count = 0;
        worker1 = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );
        worker2 = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );

        worker1.on("error", (error) => {
          throw error;
        });
        worker2.on("error", (error) => {
          throw error;
        });

        await worker1.connect();
        await worker2.connect();

        const onComplete = async () => {
          count++;
          expect(count).toBe(1);
          await worker1.end();
          await worker2.end();

          const timestamps = await queue.timestamps();
          let str = await specHelper.redis.lpop(
            specHelper.namespace +
              ":delayed:" +
              Math.round(timestamps[0] / 1000)
          );
          expect(str).toBeDefined();
          const dealyedJob = JSON.parse(str) as ParsedJob;
          expect(dealyedJob.class).toBe("slowAdd");
          expect(dealyedJob.args).toEqual([1, 2]);

          resolve(null);
        };

        worker1.on("success", onComplete);
        worker2.on("success", onComplete);

        await queue.enqueue(specHelper.queue, "slowAdd", [1, 2]);
        await queue.enqueue(specHelper.queue, "slowAdd", [1, 2]);

        worker1.start();
        worker2.start();
      });
    });

    test("can be configured not to re-enqueue a duplicate task", async () => {
      await new Promise(async (resolve) => {
        let count = 0;
        worker1 = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );
        worker2 = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );

        worker1.on("error", (error) => {
          throw error;
        });
        worker2.on("error", (error) => {
          throw error;
        });

        await worker1.connect();
        await worker2.connect();

        const onComplete = async () => {
          count++;
          expect(count).toBe(1);
          await worker1.end();
          await worker2.end();

          const timestamps = await queue.timestamps();
          expect(timestamps).toEqual([]);

          resolve(null);
        };

        worker1.on("success", onComplete);
        worker2.on("success", onComplete);

        await queue.enqueue(specHelper.queue, "withoutReEnqueue");
        await queue.enqueue(specHelper.queue, "withoutReEnqueue");

        worker1.start();
        worker2.start();
      });
    });

    test("will run 2 jobs with the different args at the same time", async () => {
      await new Promise(async (resolve) => {
        worker1 = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );
        worker2 = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );

        worker1.on("error", (error) => {
          throw error;
        });
        worker2.on("error", (error) => {
          throw error;
        });

        await worker1.connect();
        await worker2.connect();

        const startTime = new Date().getTime();
        let completed = 0;

        const onComplete = async function () {
          completed++;
          if (completed === 2) {
            await worker1.end();
            await worker2.end();
            const delta = new Date().getTime() - startTime;
            expect(delta).toBeLessThan(jobDelay * 3);
            resolve(null);
          }
        };

        worker1.on("success", onComplete);
        worker2.on("success", onComplete);

        await queue.enqueue(specHelper.queue, "slowAdd", [1, 2]);
        await queue.enqueue(specHelper.queue, "slowAdd", [3, 4]);

        worker1.start();
        worker2.start();
      });
    });
  });
});
