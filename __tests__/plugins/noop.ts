import specHelper from "../utils/specHelper";
import { Scheduler, Plugins, Queue, Worker, Job } from "../../src";

let queue: Queue;
let scheduler: Scheduler;
let loggedErrors = [];

const jobs = {
  brokenJob: {
    plugins: [Plugins.Noop],
    pluginOptions: {
      Noop: {
        logger: (error: Error) => {
          loggedErrors.push(error);
        },
      },
    },
    perform: () => {
      throw new Error("BUSTED");
    },
  } as Job<any>,
  happyJob: {
    plugins: [Plugins.Noop],
    pluginOptions: {
      Noop: {
        logger: (error: Error) => {
          loggedErrors.push(error);
        },
      },
    },
    perform: async () => {
      // nothing
    },
  } as Job<any>,
};

describe("plugins", () => {
  describe("noop", () => {
    beforeAll(async () => {
      await specHelper.connect();
      await specHelper.cleanup();
      queue = new Queue(
        {
          connection: specHelper.cleanConnectionDetails(),
          queue: specHelper.queue,
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

    beforeEach(() => {
      loggedErrors = [];
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

        worker.on("success", async () => {
          expect(loggedErrors.length).toBe(0);
          const length = await specHelper.redis.llen("resque_test:failed");
          expect(length).toBe(0);
          await worker.end();
          resolve(null);
        });

        worker.on("failure", () => {
          throw new Error("should never get here");
        });

        await worker.connect();
        await worker.start();
      });
    });

    test("will prevent any failed jobs from ending in the failed queue", async () => {
      await new Promise(async (resolve) => {
        await queue.enqueue(specHelper.queue, "brokenJob", [1, 2]);
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

        worker.on("success", async () => {
          expect(loggedErrors.length).toBe(1);
          const length = await specHelper.redis.llen("resque_test:failed");
          expect(length).toBe(0);
          await worker.end();
          resolve(null);
        });

        await worker.connect();
        worker.on("failure", () => {
          throw new Error("should never get here");
        });
        worker.start();
      });
    });
  });
});
