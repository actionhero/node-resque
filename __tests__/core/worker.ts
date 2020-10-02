import { Queue, Worker } from "../../src";
import specHelper from "../utils/specHelper";

const jobs = {
  add: {
    perform: (a, b) => {
      return a + b;
    },
  },
  badAdd: {
    perform: () => {
      throw new Error("Blue Smoke");
    },
  },
  messWithData: {
    perform: (a) => {
      a.data = "new thing";
      return a;
    },
  },
  async: {
    perform: async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
      return "yay";
    },
  },
  twoSeconds: {
    perform: async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 1000 * 2);
      });
      return "slow";
    },
  },
  quickDefine: async () => {
    return "ok";
  },
};

let worker: Worker;
let queue: Queue;

describe("worker", () => {
  afterAll(async () => {
    await specHelper.disconnect();
  });

  test("can connect", async () => {
    const worker = new Worker(
      { connection: specHelper.connectionDetails, queues: [specHelper.queue] },
      {}
    );
    await worker.connect();
    await worker.end();
  });

  test(
    "can provide an error if connection failed",
    async (done) => {
      const connectionDetails = {
        pkg: specHelper.connectionDetails.pkg,
        host: "wronghostname",
        password: specHelper.connectionDetails.password,
        port: specHelper.connectionDetails.port,
        database: specHelper.connectionDetails.database,
        namespace: specHelper.connectionDetails.namespace,
      };

      const worker = new Worker(
        {
          connection: connectionDetails,
          timeout: specHelper.timeout,
          queues: [specHelper.queue],
        },
        {}
      );

      worker.on("error", async (error) => {
        expect(error.message).toMatch(/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/);
        await worker.end();
        done();
      });

      worker.connect();
    },
    30 * 1000
  );

  describe("performInline", () => {
    beforeAll(() => {
      worker = new Worker(
        {
          connection: specHelper.connectionDetails,
          timeout: specHelper.timeout,
          queues: [specHelper.queue],
        },
        jobs
      );
    });

    test("can run a successful job", async () => {
      const result = await worker.performInline("add", [1, 2]);
      expect(result).toBe(3);
    });

    test("can run a successful async job", async () => {
      const result = await worker.performInline("async");
      expect(result).toBe("yay");
    });

    test("can run a failing job", async () => {
      try {
        await worker.performInline("badAdd", [1, 2]);
        throw new Error("should not get here");
      } catch (error) {
        expect(String(error)).toBe("Error: Blue Smoke");
      }
    });
  });

  describe("[with connection]", () => {
    beforeAll(async () => {
      await specHelper.connect();
      queue = new Queue({ connection: specHelper.connectionDetails }, {});
      await queue.connect();
    });

    afterAll(async () => {
      await specHelper.cleanup();
    });

    test("can boot and stop", async () => {
      worker = new Worker(
        {
          connection: specHelper.connectionDetails,
          timeout: specHelper.timeout,
          queues: [specHelper.queue],
        },
        jobs
      );
      await worker.connect();
      await worker.start();
      await worker.end();
    });

    test("will determine the proper queue names", async () => {
      const worker = new Worker(
        {
          connection: specHelper.connectionDetails,
          timeout: specHelper.timeout,
        },
        jobs
      );
      await worker.connect();
      expect(worker.queues).toEqual([]);
      await queue.enqueue(specHelper.queue, "badAdd", [1, 2]);
      await worker.checkQueues();
      expect(worker.queues).toEqual([specHelper.queue]);

      //@ts-ignore
      await queue.del(specHelper.queue);
      await worker.end();
    });

    describe("integration", () => {
      test("will notice new job queues when started with queues=*", async (done) => {
        const wildcardWorker = new Worker(
          {
            connection: specHelper.connectionDetails,
            timeout: specHelper.timeout,
            queues: ["*"],
          },
          jobs
        );

        await wildcardWorker.connect();
        await wildcardWorker.start();

        setTimeout(async () => {
          await queue.enqueue("__newQueue", "add", [1, 2]);
        }, 501);

        wildcardWorker.on("success", async (q, job, result, duration) => {
          expect(q).toBe("__newQueue");
          expect(job.class).toBe("add");
          expect(result).toBe(3);
          expect(wildcardWorker.result).toBe(result);
          expect(duration).toBeGreaterThanOrEqual(0);

          wildcardWorker.removeAllListeners("success");
          await wildcardWorker.end();
          done();
        });
      });

      describe("with worker", () => {
        beforeEach(async () => {
          worker = new Worker(
            {
              connection: specHelper.connectionDetails,
              timeout: specHelper.timeout,
              queues: [specHelper.queue],
            },
            jobs
          );
          await worker.connect();
        });

        afterEach(async () => {
          await worker.end();
        });

        test("will mark a job as failed", async (done) => {
          await queue.enqueue(specHelper.queue, "badAdd", [1, 2]);

          await worker.start();

          worker.on("failure", (q, job, failire) => {
            expect(q).toBe(specHelper.queue);
            expect(job.class).toBe("badAdd");
            expect(failire.message).toBe("Blue Smoke");

            worker.removeAllListeners("failure");
            done();
          });
        });

        test("can work a job and return successful things", async (done) => {
          await queue.enqueue(specHelper.queue, "add", [1, 2]);

          worker.start();

          worker.on("success", (q, job, result, duration) => {
            expect(q).toBe(specHelper.queue);
            expect(job.class).toBe("add");
            expect(result).toBe(3);
            expect(worker.result).toBe(result);
            expect(duration).toBeGreaterThanOrEqual(0);

            worker.removeAllListeners("success");
            done();
          });
        });

        // TODO: Typescript seems to have trouble with frozen objects
        // test('job arguments are immutable', async (done) => {
        //   await queue.enqueue(specHelper.queue, 'messWithData', { a: 'starting value' })

        //   worker.start()

        //   worker.on('success', (q, job, result) => {
        //     expect(result.a).toBe('starting value')
        //     expect(worker.result).toBe(result)

        //     worker.removeAllListeners('success')
        //     done()
        //   })
        // })

        test("can accept jobs that are simple functions", async (done) => {
          await queue.enqueue(specHelper.queue, "quickDefine");

          worker.start();

          worker.on("success", (q, job, result, duration) => {
            expect(result).toBe("ok");
            expect(duration).toBeGreaterThanOrEqual(0);
            worker.removeAllListeners("success");
            done();
          });
        });

        test("will not work jobs that are not defined", async (done) => {
          await queue.enqueue(specHelper.queue, "somethingFake");

          worker.start();

          worker.on("failure", (q, job, failure, duration) => {
            expect(q).toBe(specHelper.queue);
            expect(String(failure)).toBe(
              'Error: No job defined for class "somethingFake"'
            );
            expect(duration).toBeGreaterThanOrEqual(0);

            worker.removeAllListeners("failure");
            done();
          });
        });

        test("will place failed jobs in the failed queue", async () => {
          let data = await specHelper.redis.rpop(
            specHelper.namespace + ":" + "failed"
          );
          data = JSON.parse(data);
          expect(data.queue).toBe(specHelper.queue);
          expect(data.exception).toBe("Error");
          expect(data.error).toBe('No job defined for class "somethingFake"');
        });

        test("will ping with status even when working a slow job", async (done) => {
          const nowInSeconds = Math.round(new Date().getTime() / 1000);
          await worker.start();
          await new Promise((resolve) =>
            setTimeout(resolve, worker.options.timeout * 2)
          );
          const pingKey = worker.connection.key("worker", "ping", worker.name);
          const firstPayload = JSON.parse(await specHelper.redis.get(pingKey));
          expect(firstPayload.name).toEqual(worker.name);
          expect(firstPayload.time).toBeGreaterThanOrEqual(nowInSeconds);

          await queue.enqueue(specHelper.queue, "twoSeconds");

          worker.on("success", (q, job, result) => {
            expect(result).toBe("slow");
            worker.removeAllListeners("success");
            done();
          });

          const secondPayload = JSON.parse(await specHelper.redis.get(pingKey));
          expect(secondPayload.name).toEqual(worker.name);
          expect(secondPayload.time).toBeGreaterThanOrEqual(firstPayload.time);
        });
      });
    });
  });
});
