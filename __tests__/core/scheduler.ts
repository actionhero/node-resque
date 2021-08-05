import {
  Queue,
  Scheduler,
  Worker,
  Job,
  ParsedFailedJobPayload,
} from "../../src";
import specHelper from "../utils/specHelper";

let scheduler: Scheduler;
let queue: Queue;

describe("scheduler", () => {
  test("can connect", async () => {
    scheduler = new Scheduler({
      connection: specHelper.connectionDetails,
      timeout: specHelper.timeout,
    });
    await scheduler.connect();
    await scheduler.end();
  });

  describe("with specHelper", () => {
    beforeAll(async () => await specHelper.connect());
    afterAll(async () => await specHelper.disconnect());

    describe("locking", () => {
      beforeEach(async () => {
        await specHelper.cleanup();
      });
      afterAll(async () => {
        await specHelper.cleanup();
      });

      test("should only have one leader, and can failover", async () => {
        const shedulerOne = new Scheduler({
          connection: specHelper.connectionDetails,
          name: "scheduler_1",
          timeout: specHelper.timeout,
        });
        const shedulerTwo = new Scheduler({
          connection: specHelper.connectionDetails,
          name: "scheduler_2",
          timeout: specHelper.timeout,
        });

        await shedulerOne.connect();
        await shedulerTwo.connect();
        await shedulerOne.start();
        await shedulerTwo.start();

        await new Promise((resolve) => {
          setTimeout(resolve, specHelper.timeout * 2);
        });
        expect(shedulerOne.leader).toBe(true);
        expect(shedulerTwo.leader).toBe(false);
        await shedulerOne.end();

        await new Promise((resolve) => {
          setTimeout(resolve, specHelper.timeout * 2);
        });
        expect(shedulerOne.leader).toBe(false);
        expect(shedulerTwo.leader).toBe(true);
        await shedulerTwo.end();
      });
    });

    describe("[with connection]", () => {
      beforeEach(async () => {
        await specHelper.cleanup();
        scheduler = new Scheduler({
          connection: specHelper.connectionDetails,
          timeout: specHelper.timeout,
          stuckWorkerTimeout: 1000,
        });
        queue = new Queue({
          connection: specHelper.connectionDetails,
          queue: specHelper.queue,
        });
        await scheduler.connect();
        await queue.connect();
      });

      test("can start and stop", async () => {
        await scheduler.start();
        await scheduler.end();
        await queue.end();
      });

      test("queues can see who the leader is", async () => {
        await scheduler.poll();
        const leader = await queue.leader();
        expect(leader).toBe(scheduler.options.name);
        await scheduler.end();
      });

      test("will move enqueued jobs when the time comes", async () => {
        await queue.enqueueAt(
          1000 * 10,
          specHelper.queue,
          "someJob",
          [1, 2, 3]
        );
        await scheduler.poll();
        let obj = await specHelper.popFromQueue();
        expect(obj).toBeDefined();
        obj = JSON.parse(obj);
        expect(obj.class).toBe("someJob");
        expect(obj.args).toEqual([1, 2, 3]);
        await scheduler.end();
      });

      test("will not move jobs in the future", async () => {
        await queue.enqueueAt(
          new Date().getTime() + 10000,
          specHelper.queue,
          "someJob",
          [1, 2, 3]
        );
        await scheduler.poll();
        const obj = await specHelper.popFromQueue();
        expect(obj).toBeFalsy();
        await scheduler.end();
      });

      describe("stuck workers", () => {
        let worker: Worker;
        const jobs = {
          stuck: {
            perform: async function () {
              await new Promise((resolve) => {
                // stop the worker from checking in, like the process crashed
                // don't resolve
                clearTimeout(this.pingTimer);
              });
            },
          } as Job<any>,
        };

        beforeAll(async () => {
          worker = new Worker(
            {
              connection: specHelper.connectionDetails,
              timeout: specHelper.timeout,
              queues: ["stuckJobs"],
            },
            jobs
          );
          await worker.connect();
        });

        afterAll(async () => {
          await scheduler.end();
        });

        test("will remove stuck workers and fail their jobs", async () => {
          await new Promise(async (resolve) => {
            await scheduler.connect();
            await scheduler.start();
            await worker.start();

            const workers = await queue.allWorkingOn();
            const h: { [key: string]: any } = {};
            h[worker.name] = "started";
            expect(workers).toEqual(h);

            await queue.enqueue("stuckJobs", "stuck", ["oh no!"]);

            scheduler.on(
              "cleanStuckWorker",
              async (workerName, errorPayload, delta) => {
                // response data should contain failure
                expect(workerName).toEqual(worker.name);
                expect(errorPayload.worker).toEqual(worker.name);
                expect(errorPayload.error).toEqual(
                  "Worker Timeout (killed manually)"
                );

                // check the workers list, should be empty now
                expect(await queue.allWorkingOn()).toEqual({});

                // check the failed list
                const str = await specHelper.redis.rpop(
                  specHelper.namespace + ":" + "failed"
                );
                const failed = JSON.parse(str) as ParsedFailedJobPayload;
                expect(failed.queue).toBe("stuckJobs");
                expect(failed.exception).toBe(
                  "Worker Timeout (killed manually)"
                );
                expect(failed.error).toBe("Worker Timeout (killed manually)");

                scheduler.removeAllListeners("cleanStuckWorker");
                resolve(null);
              }
            );
          });
        });
      });
    });
  });
});
