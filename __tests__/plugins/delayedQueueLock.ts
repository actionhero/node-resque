import specHelper from "../utils/specHelper";
import { Plugin, Queue, Worker } from "../../src";

let queue;
const jobDelay = 100;

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
  uniqueJob: {
    plugins: ["DelayQueueLock"],
    pluginOptions: { queueLock: {}, delayQueueLock: {} },
    perform: async (a, b) => {
      const answer = a + b;
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
    queue.connect();
  });

  afterAll(async () => {
    await queue.end();
    await specHelper.cleanup();
    await specHelper.disconnect();
  });

  beforeEach(async () => {
    await specHelper.cleanup();
  });

  describe("delayQueueLock", () => {
    test("will not enque a job with the same args if it is already in the delayed queue", async () => {
      await queue.enqueueIn(10 * 1000, specHelper.queue, "uniqueJob", [1, 2]);
      await queue.enqueue(specHelper.queue, "uniqueJob", [1, 2]);
      const delayedLen = await specHelper.redis.zcount(
        specHelper.namespace + ":delayed_queue_schedule",
        "-inf",
        "+inf"
      );
      const queueLen = await queue.length(specHelper.queue);
      expect(delayedLen).toBe(1);
      expect(queueLen).toBe(0);
    });

    test("will enque a job with the different args", async () => {
      await queue.enqueueIn(10 * 1000, specHelper.queue, "uniqueJob", [1, 2]);
      await queue.enqueue(specHelper.queue, "uniqueJob", [3, 4]);
      const delayedLen = await specHelper.redis.zcount(
        specHelper.namespace + ":delayed_queue_schedule",
        "-inf",
        "+inf"
      );
      const queueLen = await queue.length(specHelper.queue);
      expect(delayedLen).toBe(1);
      expect(queueLen).toBe(1);
    });
  });
});
