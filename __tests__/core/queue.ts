import {
  ParsedJob,
  ParsedFailedJobPayload,
  Queue,
  Worker,
  Job,
} from "../../src";
import specHelper from "../utils/specHelper";
let queue: Queue;

describe("queue", () => {
  afterAll(async () => {
    await specHelper.disconnect();
  });

  test("can connect", async () => {
    queue = new Queue(
      { connection: specHelper.connectionDetails, queue: specHelper.queue },
      {}
    );
    await queue.connect();
    await queue.end();
  });

  describe("[with connection]", () => {
    beforeAll(async () => {
      await specHelper.connect();
      queue = new Queue(
        { connection: specHelper.connectionDetails, queue: specHelper.queue },
        {}
      );
      await queue.connect();
    });

    beforeEach(async () => {
      await specHelper.cleanup();
    });
    afterAll(async () => {
      await specHelper.cleanup();
    });

    test("can add a normal job", async () => {
      await queue.enqueue(specHelper.queue, "someJob", [1, 2, 3]);
      let obj = await specHelper.popFromQueue();
      expect(obj).toBeDefined();
      obj = JSON.parse(obj);
      expect(obj.class).toBe("someJob");
      expect(obj.args).toEqual([1, 2, 3]);
    });

    test("can add delayed job (enqueueAt)", async () => {
      await queue.enqueueAt(10000, specHelper.queue, "someJob", [1, 2, 3]);
      const score = await specHelper.redis.zscore(
        specHelper.namespace + ":delayed_queue_schedule",
        "10"
      );
      expect(String(score)).toBe("10");

      const str = await specHelper.redis.lpop(
        specHelper.namespace + ":delayed:" + "10"
      );
      expect(str).toBeDefined();
      const job = JSON.parse(str) as ParsedJob;
      expect(job.class).toBe("someJob");
      expect(job.args).toEqual([1, 2, 3]);
    });

    test("can add delayed job whose timestamp is a string (enqueueAt)", async () => {
      //@ts-ignore
      await queue.enqueueAt("10000", specHelper.queue, "someJob", [1, 2, 3]);
      const score = await specHelper.redis.zscore(
        specHelper.namespace + ":delayed_queue_schedule",
        "10"
      );
      expect(String(score)).toBe("10");

      let str = await specHelper.redis.lpop(
        specHelper.namespace + ":delayed:" + "10"
      );
      expect(str).toBeDefined();
      const job = JSON.parse(str) as ParsedJob;
      expect(job.class).toBe("someJob");
      expect(job.args).toEqual([1, 2, 3]);
    });

    test("will not enqueue a delayed job at the same time with matching params with error", async () => {
      await queue.enqueueAt(10000, specHelper.queue, "someJob", [1, 2, 3]);
      await expect(
        queue.enqueueAt(10000, specHelper.queue, "someJob", [1, 2, 3])
      ).rejects.toThrow(
        /Job already enqueued at this time with same arguments/
      );

      const { tasks } = await queue.delayedAt(10000);
      expect(tasks.length).toBe(1);
    });

    test("will not enqueue a delayed job at the same time with matching params with error suppressed", async () => {
      await queue.enqueueAt(10000, specHelper.queue, "someJob", [1, 2, 3]);
      await queue.enqueueAt(
        10000,
        specHelper.queue,
        "someJob",
        [1, 2, 3],
        true
      ); // no error

      const { tasks } = await queue.delayedAt(10000);
      expect(tasks.length).toBe(1);
    });

    test("can add delayed job (enqueueIn)", async () => {
      const now = Math.round(new Date().getTime() / 1000) + 5;
      await queue.enqueueIn(5 * 1000, specHelper.queue, "someJob", [1, 2, 3]);
      const score = await specHelper.redis.zscore(
        specHelper.namespace + ":delayed_queue_schedule",
        now.toString()
      );
      expect(String(score)).toBe(String(now));

      let str = await specHelper.redis.lpop(
        specHelper.namespace + ":delayed:" + now
      );
      expect(str).toBeDefined();
      const job = JSON.parse(str) as ParsedJob;
      expect(job.class).toBe("someJob");
      expect(job.args).toEqual([1, 2, 3]);
    });

    test("can add a delayed job whose time is a string (enqueueIn)", async () => {
      const now = Math.round(new Date().getTime() / 1000) + 5;
      const time = 5 * 1000;

      await queue.enqueueIn(time, specHelper.queue, "someJob", [1, 2, 3]);
      const score = await specHelper.redis.zscore(
        specHelper.namespace + ":delayed_queue_schedule",
        now.toString()
      );
      expect(String(score)).toBe(String(now));

      let str = await specHelper.redis.lpop(
        specHelper.namespace + ":delayed:" + now
      );
      expect(str).toBeDefined();
      const job = JSON.parse(str) as ParsedJob;
      expect(job.class).toBe("someJob");
      expect(job.args).toEqual([1, 2, 3]);
    });

    test("can get the number of jobs currently enqueued", async () => {
      await queue.enqueue(specHelper.queue, "someJob", [1, 2, 3]);
      await queue.enqueue(specHelper.queue, "someJob", [1, 2, 3]);
      const length = await queue.length(specHelper.queue);
      expect(length).toBe(2);
    });

    test("can get the jobs in the queue", async () => {
      await queue.enqueue(specHelper.queue, "someJob", [1, 2, 3]);
      await queue.enqueue(specHelper.queue, "someJob", [4, 5, 6]);
      const jobs = await queue.queued(specHelper.queue, 0, -1);
      expect(jobs.length).toBe(2);
      expect(jobs[0].args).toEqual([1, 2, 3]);
      expect(jobs[1].args).toEqual([4, 5, 6]);
    });

    test("can find previously scheduled jobs", async () => {
      await queue.enqueueAt(10000, specHelper.queue, "someJob", [1, 2, 3]);
      const timestamps = await queue.scheduledAt(
        specHelper.queue,
        "someJob",
        [1, 2, 3]
      );
      expect(timestamps.length).toBe(1);
      expect(timestamps[0]).toBe(10);
    });

    test("will not match previously scheduled jobs with differnt args", async () => {
      await queue.enqueueAt(10000, specHelper.queue, "someJob", [1, 2, 3]);
      const timestamps = await queue.scheduledAt(
        specHelper.queue,
        "someJob",
        [3, 2, 1]
      );
      expect(timestamps.length).toBe(0);
    });

    test("can delete an enqueued job", async () => {
      await queue.enqueue(specHelper.queue, "someJob", [1, 2, 3]);
      const length = await queue.length(specHelper.queue);
      expect(length).toBe(1);

      await queue.del(specHelper.queue, "someJob", [1, 2, 3]);
      const lengthAgain = await queue.length(specHelper.queue);
      expect(lengthAgain).toBe(0);
    });

    test("can delete all enqueued jobs of a particular function/class", async () => {
      await queue.enqueue(specHelper.queue, "someJob1", [1, 2, 3]);
      const length = await queue.length(specHelper.queue);
      expect(length).toBe(1);

      await queue.enqueue(specHelper.queue, "someJob1", [1, 2, 3]);
      const lengthAgain = await queue.length(specHelper.queue);
      expect(lengthAgain).toBe(2);

      await queue.enqueue(specHelper.queue, "someJob2", [1, 2, 3]);
      const lengthOnceAgain = await queue.length(specHelper.queue);
      expect(lengthOnceAgain).toBe(3);

      const countDeleted = await queue.delByFunction(
        specHelper.queue,
        "someJob1"
      );
      const lengthFinally = await queue.length(specHelper.queue);
      expect(countDeleted).toBe(2);
      expect(lengthFinally).toBe(1);
    });

    test("can delete a delayed job", async () => {
      await queue.enqueueAt(10000, specHelper.queue, "someJob", [1, 2, 3]);
      const timestamps = await queue.delDelayed(
        specHelper.queue,
        "someJob",
        [1, 2, 3]
      );
      expect(timestamps.length).toBe(1);
      expect(timestamps[0]).toBe(10);
    });

    test("can delete a delayed job, and delayed queue should be empty", async () => {
      await queue.enqueueAt(10000, specHelper.queue, "someJob", [1, 2, 3]);
      const timestamps = await queue.delDelayed(
        specHelper.queue,
        "someJob",
        [1, 2, 3]
      );
      const hash = await queue.allDelayed();
      expect(Object.keys(hash)).toHaveLength(0);
      expect(timestamps.length).toBe(1);
      expect(timestamps[0]).toBe(10);
    });

    test("can handle single arguments without explicit array", async () => {
      // @ts-ignore
      await queue.enqueue(specHelper.queue, "someJob", 1);
      const obj = await specHelper.popFromQueue();
      expect(JSON.parse(obj).args).toEqual([1]);
    });

    test("allows omitting arguments when enqueuing", async () => {
      await queue.enqueue(specHelper.queue, "noParams");
      const length = await queue.length(specHelper.queue);
      expect(length).toBe(1);
      let obj = await specHelper.popFromQueue();
      obj = JSON.parse(obj);
      expect(obj.class).toBe("noParams");
      expect(Array.isArray(obj.args)).toBe(true);
      expect(obj.args).toHaveLength(0);
    });

    test("allows omitting arguments when deleting", async () => {
      await queue.enqueue(specHelper.queue, "noParams", []);
      await queue.enqueue(specHelper.queue, "noParams", []);
      const length = await queue.length(specHelper.queue);
      expect(length).toBe(2);

      const deletedCount = await queue.del(specHelper.queue, "noParams");
      expect(deletedCount).toBe(2);

      const deletedCountAgain = await queue.del(specHelper.queue, "noParams");
      expect(deletedCountAgain).toBe(0);
      const lengthAgain = await queue.length(specHelper.queue);
      expect(lengthAgain).toBe(0);
    });

    test("allows omitting arguments when adding delayed job", async () => {
      const hash = await queue.allDelayed();
      expect(Object.keys(hash)).toHaveLength(0);

      await queue.enqueueAt(10000, specHelper.queue, "noParams", []);
      await queue.enqueueIn(11000, specHelper.queue, "noParams", []);
      await queue.enqueueAt(12000, specHelper.queue, "noParams", []);
      await queue.enqueueIn(13000, specHelper.queue, "noParams", []);

      const timestamps = await queue.scheduledAt(
        specHelper.queue,
        "noParams",
        []
      );
      expect(timestamps.length).toBe(4);
      const hashAgain = await queue.allDelayed();
      expect(Object.keys(hashAgain).length).toBe(4);
      for (const key in hashAgain) {
        expect(hashAgain[key][0].args).toHaveLength(0);
        expect(Array.isArray(hashAgain[key][0].args)).toBe(true);
      }
    });

    test("allows omitting arguments when deleting a delayed job", async () => {
      const hash = await queue.allDelayed();
      expect(Object.keys(hash)).toHaveLength(0);

      await queue.enqueueAt(10000, specHelper.queue, "noParams");
      await queue.enqueueAt(12000, specHelper.queue, "noParams");

      const hashAgain = await queue.allDelayed();
      expect(Object.keys(hashAgain).length).toBe(2);

      await queue.delDelayed(specHelper.queue, "noParams");
      await queue.delDelayed(specHelper.queue, "noParams");
      const hashThree = queue.allDelayed();
      expect(Object.keys(hashThree)).toHaveLength(0);
    });

    test("can determine who the leader is", async () => {
      await queue.connection.redis.set(queue.leaderKey(), "the_scheduler");
      let leader = await queue.leader();
      expect(leader).toBe("the_scheduler");
    });

    test("can load stats", async () => {
      await queue.connection.redis.set(
        specHelper.namespace + ":stat:failed",
        1
      );
      await queue.connection.redis.set(
        specHelper.namespace + ":stat:processed",
        2
      );

      const stats = await queue.stats();
      expect(stats.processed).toBe("2");
      expect(stats.failed).toBe("1");
    });

    describe("locks", () => {
      beforeEach(async () => {
        await queue.connection.redis.set(
          queue.connection.key("lock:lists:queueName:jobName:[{}]"),
          123
        );
        await queue.connection.redis.set(
          queue.connection.key("workerslock:lists:queueName:jobName:[{}]"),
          456
        );
      });

      afterEach(async () => {
        await queue.connection.redis.del(
          queue.connection.key("lock:lists:queueName:jobName:[{}]")
        );
        await queue.connection.redis.del(
          queue.connection.key("workerslock:lists:queueName:jobName:[{}]")
        );
      });

      test("can get locks", async () => {
        const locks = await queue.locks();
        expect(Object.keys(locks).length).toBe(2);
        expect(locks["lock:lists:queueName:jobName:[{}]"]).toBe("123");
        expect(locks["workerslock:lists:queueName:jobName:[{}]"]).toBe("456");
      });

      test("can remove locks", async () => {
        const locks = await queue.locks();
        expect(Object.keys(locks).length).toBe(2);
        const count = await queue.delLock(
          "workerslock:lists:queueName:jobName:[{}]"
        );
        expect(count).toBe(1);
      });
    });

    describe("failed job managment", () => {
      beforeEach(async () => {
        const errorPayload = function (id: number) {
          return JSON.stringify({
            worker: "busted-worker-" + id,
            queue: "busted-queue",
            payload: {
              class: "busted_job",
              queue: "busted-queue",
              args: [1, 2, 3],
            },
            exception: "ERROR_NAME",
            error: "I broke",
            failed_at: new Date().toString(),
          });
        };

        await queue.connection.redis.rpush(
          queue.connection.key("failed"),
          errorPayload(1)
        );
        await queue.connection.redis.rpush(
          queue.connection.key("failed"),
          errorPayload(2)
        );
        await queue.connection.redis.rpush(
          queue.connection.key("failed"),
          errorPayload(3)
        );
      });

      test("can list how many failed jobs there are", async () => {
        const failedCount = await queue.failedCount();
        expect(failedCount).toBe(3);
      });

      test("can get the body content for a collection of failed jobs", async () => {
        const failedJobs = await queue.failed(1, 2);
        expect(failedJobs.length).toBe(2);

        expect(failedJobs[0].worker).toBe("busted-worker-2");
        expect(failedJobs[0].queue).toBe("busted-queue");
        expect(failedJobs[0].exception).toBe("ERROR_NAME");
        expect(failedJobs[0].error).toBe("I broke");
        expect(failedJobs[0].payload.args).toEqual([1, 2, 3]);

        expect(failedJobs[1].worker).toBe("busted-worker-3");
        expect(failedJobs[1].queue).toBe("busted-queue");
        expect(failedJobs[1].exception).toBe("ERROR_NAME");
        expect(failedJobs[1].error).toBe("I broke");
        expect(failedJobs[1].payload.args).toEqual([1, 2, 3]);
      });

      test("can remove a failed job by payload", async () => {
        const failedJobs = await queue.failed(1, 1);
        expect(failedJobs.length).toBe(1);
        const removedJobs = await queue.removeFailed(failedJobs[0]);
        expect(removedJobs).toBe(1);
        const failedCountAgain = await queue.failedCount();
        expect(failedCountAgain).toBe(2);
      });

      test("can re-enqueue a specific job, removing it from the failed queue", async () => {
        const failedJobs = await queue.failed(0, 999);
        expect(failedJobs.length).toBe(3);
        expect(failedJobs[2].worker).toBe("busted-worker-3");

        await queue.retryAndRemoveFailed(failedJobs[2]);
        const failedJobsAgain = await queue.failed(0, 999);
        expect(failedJobsAgain.length).toBe(2);
        expect(failedJobsAgain[0].worker).toBe("busted-worker-1");
        expect(failedJobsAgain[1].worker).toBe("busted-worker-2");
      });

      test("will return an error when trying to retry a job not in the failed queue", async () => {
        const failedJobs = await queue.failed(0, 999);
        expect(failedJobs.length).toBe(3);

        const failedJob = failedJobs[2];
        failedJob.worker = "a-fake-worker";
        try {
          await queue.retryAndRemoveFailed(failedJob);
          throw new Error("should not get here");
        } catch (error) {
          expect(String(error)).toBe("Error: This job is not in failed queue");
          const failedJobsAgain = await queue.failed(0, 999);
          expect(failedJobsAgain.length).toBe(3);
        }
      });
    });

    describe("delayed status", () => {
      beforeEach(async () => {
        await queue.enqueueAt(10000, specHelper.queue, "job1", [1, 2, 3]);
        await queue.enqueueAt(10000, specHelper.queue, "job2", [1, 2, 3]);
        await queue.enqueueAt(20000, specHelper.queue, "job3", [1, 2, 3]);
      });

      test("can list the timestamps that exist", async () => {
        const timestamps = await queue.timestamps();
        expect(timestamps.length).toBe(2);
        expect(timestamps[0]).toBe(10000);
        expect(timestamps[1]).toBe(20000);
      });

      test("can list the jobs delayed at a timestamp", async () => {
        const tasksA = await queue.delayedAt(10000);
        expect(tasksA.rTimestamp).toBe(10);
        expect(tasksA.tasks.length).toBe(2);
        expect(tasksA.tasks[0].class).toBe("job1");
        expect(tasksA.tasks[1].class).toBe("job2");

        const tasksB = await queue.delayedAt(20000);
        expect(tasksB.rTimestamp).toBe(20);
        expect(tasksB.tasks.length).toBe(1);
        expect(tasksB.tasks[0].class).toBe("job3");
      });

      test("can also return a hash with all delayed tasks", async () => {
        const hash = await queue.allDelayed();
        expect(Object.keys(hash).length).toBe(2);
        expect(Object.keys(hash)[0]).toBe("10000");
        expect(Object.keys(hash)[1]).toBe("20000");
        expect(hash["10000"].length).toBe(2);
        expect(hash["20000"].length).toBe(1);
      });
    });

    describe("worker status", () => {
      let workerA: Worker;
      let workerB: Worker;
      const timeout = 500;

      const jobs = {
        slowJob: {
          perform: async () => {
            await new Promise((resolve) => {
              setTimeout(resolve, timeout);
            });
          },
        } as Job<any>,
      };

      beforeEach(async () => {
        workerA = new Worker(
          {
            connection: specHelper.connectionDetails,
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
            name: "workerA",
          },
          jobs
        );

        workerB = new Worker(
          {
            connection: specHelper.connectionDetails,
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
            name: "workerB",
          },
          jobs
        );

        await workerA.connect();
        await workerA.init();
        await workerB.connect();
        await workerB.init();
      });

      afterEach(async () => {
        await workerA.end();
        await workerB.end();
      });

      test("can list running workers", async () => {
        const workers = await queue.workers();
        expect(workers.workerA).toBe("test_queue");
        expect(workers.workerB).toBe("test_queue");
      });

      test("we can see what workers are working on (idle)", async () => {
        const data = await queue.allWorkingOn();
        expect(data).toHaveProperty("workerA", "started");
        expect(data).toHaveProperty("workerB", "started");
      });

      test("we can see what workers are working on (active)", async () => {
        await new Promise(async (resolve) => {
          queue.enqueue(specHelper.queue, "slowJob");
          workerA.start();

          workerA.on("job", async () => {
            workerA.removeAllListeners("job");

            const data = await queue.allWorkingOn();
            expect(data).toHaveProperty("workerB", "started");
            const paylaod = data.workerA.payload;
            expect(paylaod.queue).toBe("test_queue");
            expect(paylaod.class).toBe("slowJob");

            return resolve(null);
          });
        });
      });

      test("can remove stuck workers and re-enqueue their jobs", async () => {
        await new Promise(async (resolve) => {
          const age = 1;
          await queue.enqueue(specHelper.queue, "slowJob", [{ a: 1 }]);
          await workerA.start();

          // hijack a worker in the middle of working on a job
          workerA.on("job", async () => {
            workerA.removeAllListeners("job");

            const workingOnData = await queue.allWorkingOn();
            const paylaod = workingOnData.workerA.payload;
            expect(paylaod.queue).toBe("test_queue");
            expect(paylaod.class).toBe("slowJob");
            expect(paylaod.args[0].a).toBe(1);

            const runAt = Date.parse(workingOnData.workerA.run_at);
            const now = new Date().getTime();
            expect(runAt).toBeGreaterThanOrEqual(now - 1001);
            expect(runAt).toBeLessThanOrEqual(now);

            const cleanData = await queue.cleanOldWorkers(age);
            expect(Object.keys(cleanData).length).toBe(1);
            expect(cleanData.workerA.queue).toBe("test_queue");
            expect(cleanData.workerA.worker).toBe("workerA");
            expect(cleanData.workerA.payload.class).toBe("slowJob");
            expect(cleanData.workerA.payload.args[0].a).toBe(1);

            let str = await specHelper.redis.rpop(
              specHelper.namespace + ":" + "failed"
            );
            const failedData = JSON.parse(str) as ParsedFailedJobPayload;
            expect(failedData.queue).toBe(specHelper.queue);
            expect(failedData.exception).toBe(
              "Worker Timeout (killed manually)"
            );
            expect(failedData.error).toBe("Worker Timeout (killed manually)");
            expect(failedData.payload.class).toBe("slowJob");
            expect(failedData.payload.args[0].a).toBe(1);

            const workingOnDataAgain = await queue.allWorkingOn();
            expect(Object.keys(workingOnDataAgain).length).toBe(1);
            expect(workingOnDataAgain.workerB).toBe("started");

            return resolve(null);
          });
        });
      });

      test("will not remove stuck jobs within the time limit", async () => {
        await new Promise(async (resolve) => {
          const age = 999;
          queue.enqueue(specHelper.queue, "slowJob");
          workerA.start();

          // hijack a worker in the middle of working on a job
          workerA.on("job", async () => {
            workerA.removeAllListeners("job");

            const data = await queue.cleanOldWorkers(age);
            expect(Object.keys(data).length).toBe(0);

            const workingOn = await queue.allWorkingOn();
            const paylaod = workingOn.workerA.payload;
            expect(paylaod.queue).toBe("test_queue");
            expect(paylaod.class).toBe("slowJob");

            return resolve(null);
          });
        });
      });

      test("can forceClean a worker, returning the error payload", async () => {
        await new Promise(async (resolve) => {
          queue.enqueue(specHelper.queue, "slowJob");
          workerA.start();

          // hijack a worker in the middle of working on a job
          workerA.on("job", async () => {
            workerA.removeAllListeners("job");

            const errorPayload = await queue.forceCleanWorker(workerA.name);

            expect(errorPayload.worker).toBe("workerA");
            expect(errorPayload.queue).toBe("test_queue");
            expect(errorPayload.payload.class).toBe("slowJob");
            expect(errorPayload.exception).toBe(
              "Worker Timeout (killed manually)"
            );
            expect(errorPayload.backtrace[0]).toMatch(/killed by/);
            expect(errorPayload.backtrace[1]).toBe("queue#forceCleanWorker");
            expect(errorPayload.backtrace[2]).toBe("node-resque");
            expect(errorPayload.failed_at).toBeTruthy();

            return resolve(null);
          });
        });
      });

      test("can forceClean a worker, returning the error payload and removing all keys it had set in redis", async () => {
        queue.enqueue(specHelper.queue, "slowJob");
        workerA.start();

        // wait for the job to complete
        await new Promise((resolve) => {
          setTimeout(resolve, 501 + 100);
        });

        const errorPayload = await queue.forceCleanWorker(workerA.name);
        expect(errorPayload).toBeFalsy(); // no job should have been running after the wait

        const keys = await specHelper.redis.keys(specHelper.namespace + "*");
        keys.map((key) => {
          expect(key).not.toMatch(/workerA/);
        });
      });

      test("retryStuckJobs", async () => {
        await new Promise(async (resolve) => {
          queue.enqueue(specHelper.queue, "slowJob");
          workerA.start();

          // hijack a worker in the middle of working on a job
          workerA.on("job", async () => {
            workerA.removeAllListeners("job");

            await queue.forceCleanWorker(workerA.name);
            let failedJobs = await queue.failed(0, 100);
            expect(failedJobs.length).toBe(1);

            await queue.retryStuckJobs();

            failedJobs = await queue.failed(0, 100);
            expect(failedJobs.length).toBe(0);

            return resolve(null);
          });
        });
      });
    });
  });
});
