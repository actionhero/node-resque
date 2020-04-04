import specHelper from "../utils/specHelper";
import { Queue, Worker } from "../../src";

let queue;
const jobDelay = 1000;
let worker1;
let worker2;

const jobs = {
  slowAdd: {
    plugins: ["JobLock"],
    pluginOptions: { jobLock: {} },
    perform: async (a, b) => {
      const answer = a + b;
      await new Promise((resolve) => {
        setTimeout(resolve, jobDelay);
      });
      return answer;
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
        queues: [specHelper.queue],
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

        const onComplete = function (q, job, result) {
          completed++;
          if (completed === 2) {
            worker1.end();
            worker2.end();
            expect(new Date().getTime() - startTime).toBeLessThan(jobDelay * 2);
            resolve();
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

    test("allows the key to be specified as a function", async (done) => {
      let calls = 0;

      const functionJobs = {
        jobLockAdd: {
          plugins: ["JobLock"],
          pluginOptions: {
            JobLock: {
              key: function () {
                // Once to create, once to delete
                if (++calls === 2) {
                  worker1.end();
                  done();
                }
                const key = this.worker.connection.key(
                  "customKey",
                  Math.max.apply(Math.max, this.args)
                );
                return key;
              },
            },
          },
          perform: (a, b) => {
            return a + b;
          },
        },
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

    test("will not run 2 jobs with the same args at the same time", async (done) => {
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
        let dealyedJob = await specHelper.redis.lpop(
          specHelper.namespace + ":delayed:" + Math.round(timestamps[0] / 1000)
        );
        expect(dealyedJob).toBeDefined();
        dealyedJob = JSON.parse(dealyedJob);
        expect(dealyedJob.class).toBe("slowAdd");
        expect(dealyedJob.args).toEqual([1, 2]);

        done();
      };

      worker1.on("success", onComplete);
      worker2.on("success", onComplete);

      await queue.enqueue(specHelper.queue, "slowAdd", [1, 2]);
      await queue.enqueue(specHelper.queue, "slowAdd", [1, 2]);

      worker1.start();
      worker2.start();
    });

    test("will run 2 jobs with the different args at the same time", async (done) => {
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

      const onComplete = async function (q, job, result) {
        completed++;
        if (completed === 2) {
          await worker1.end();
          await worker2.end();
          var delta = new Date().getTime() - startTime;
          expect(delta).toBeLessThan(jobDelay * 2);
          done();
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
