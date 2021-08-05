import specHelper from "../utils/specHelper";
import { Plugin, Plugins, Queue, Worker, Job } from "../../src";

let queue: Queue;
class NeverRunPlugin extends Plugin {
  async beforeEnqueue() {
    return true;
  }

  async afterEnqueue() {
    return true;
  }

  async beforePerform() {
    return false;
  }

  async afterPerform() {
    return true;
  }
}

const jobs = {
  uniqueJob: {
    plugins: [Plugins.QueueLock],
    pluginOptions: { queueLock: {}, delayQueueLock: {} },
    perform: (a, b) => a + b,
  } as Job<any>,
  blockingJob: {
    plugins: [Plugins.QueueLock, NeverRunPlugin],
    perform: (a, b) => a + b,
  } as Job<any>,
  jobWithLockTimeout: {
    plugins: [Plugins.QueueLock],
    pluginOptions: {
      QueueLock: {
        lockTimeout: specHelper.timeout,
      },
    },
    perform: (a, b) => a + b,
  } as Job<any>,
  stuckJob: {
    plugins: [Plugins.QueueLock],
    pluginOptions: {
      QueueLock: {
        lockTimeout: specHelper.smallTimeout,
      },
    },
    perform: async (a, b) => {
      a + b;
    },
  } as Job<any>,
};

describe("plugins", () => {
  describe("queueLock", () => {
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

    beforeEach(async () => {
      await specHelper.cleanup();
    });
    afterEach(async () => {
      await specHelper.cleanup();
    });

    afterAll(async () => {
      await queue.end();
      await specHelper.disconnect();
    });

    test("will not enque a job with the same args if it is already in the queue", async () => {
      const tryOne = await queue.enqueue(specHelper.queue, "uniqueJob", [1, 2]);
      const tryTwo = await queue.enqueue(specHelper.queue, "uniqueJob", [1, 2]);
      const length = await queue.length(specHelper.queue);
      expect(length).toBe(1);
      expect(tryOne).toBe(true);
      expect(tryTwo).toBe(false);
    });

    test("will enque a job with the different args", async () => {
      const tryOne = await queue.enqueue(specHelper.queue, "uniqueJob", [1, 2]);
      const tryTwo = await queue.enqueue(specHelper.queue, "uniqueJob", [3, 4]);
      const length = await queue.length(specHelper.queue);
      expect(length).toBe(2);
      expect(tryOne).toBe(true);
      expect(tryTwo).toBe(true);
    });

    test("will enqueue a job with timeout set by QueueLock plugin options and check its ttl", async () => {
      let job = "jobWithLockTimeout";
      const enqueue = await queue.enqueue(specHelper.queue, job, [1, 2]);
      const length = await queue.length(specHelper.queue);
      expect(length).toBe(1);
      expect(enqueue).toBe(true);
      const result = await specHelper.redis.keys(
        specHelper.namespace + ":lock*"
      );
      expect(result).toHaveLength(1);
      const ttl = await specHelper.redis.ttl(
        specHelper.namespace +
          ":lock" +
          ":" +
          job +
          ":" +
          specHelper.queue +
          ":[1,2]"
      );
      expect(ttl).toBe(specHelper.timeout);
    });

    test("will enqueue a repeated stuck job after another one to overwrite the ttl and the expiration time of the lock", async () => {
      let stuckJob = "stuckJob";
      const tryOne = await queue.enqueue(specHelper.queue, stuckJob, [1, 2]);
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min((specHelper.smallTimeout + 1) * 1000, 4000)
        )
      );
      const tryTwo = await queue.enqueue(specHelper.queue, stuckJob, [1, 2]);

      const length = await queue.length(specHelper.queue);
      expect(length).toBe(2);
      expect(tryOne).toBe(true);
      expect(tryTwo).toBe(true);

      const result = await specHelper.redis.keys(
        specHelper.namespace + ":lock*"
      );
      expect(result).toHaveLength(1);
      const ttl = await specHelper.redis.ttl(
        specHelper.namespace +
          ":lock" +
          ":" +
          stuckJob +
          ":" +
          specHelper.queue +
          ":[1,2]"
      );
      expect(ttl).toBe(specHelper.smallTimeout);
    });

    describe("with worker", () => {
      let worker: Worker;

      beforeEach(async () => {
        worker = new Worker(
          {
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: [specHelper.queue],
          },
          jobs
        );

        worker.on("error", (error) => {
          throw error;
        });
        await worker.connect();
      });

      test("will remove a lock on a job when the job has been worked", async () => {
        const enqueue = await queue.enqueue(
          specHelper.queue,
          "uniqueJob",
          [1, 2]
        );
        expect(enqueue).toBe(true);

        await worker.start();
        await worker.end();

        const result = await specHelper.redis.keys(
          specHelper.namespace + ":lock*"
        );
        expect(result).toHaveLength(0);
      });

      test("will remove a lock on a job if a plugin does not run the job", async () => {
        const enqueue = await queue.enqueue(
          specHelper.queue,
          "blockingJob",
          [1, 2]
        );
        expect(enqueue).toBe(true);

        await worker.start();
        await worker.end();

        const result = await specHelper.redis.keys(
          specHelper.namespace + ":lock*"
        );
        expect(result).toHaveLength(0);
      });
    });
  });
});
