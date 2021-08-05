import specHelper from "../utils/specHelper";
import { Queue, Job } from "../../src";
import { CustomPlugin } from "../utils/custom-plugin";

describe("plugins", () => {
  describe("custom plugins", () => {
    test("runs a custom plugin outside of the plugins directory", async () => {
      const jobs = {
        //@ts-ignore
        myJob: {
          plugins: [CustomPlugin],
          perform: async () => {
            throw new Error("should not get here");
          },
        } as Job<any>,
      };

      const queue = new Queue(
        {
          connection: specHelper.cleanConnectionDetails(),
          queue: specHelper.queue,
        },
        jobs
      );

      await queue.connect();
      const enqueueResponse = await queue.enqueue(
        specHelper.queue,
        "myJob",
        [1, 2]
      );
      expect(enqueueResponse).toBe(false);
      const length = await queue.length(specHelper.queue);
      expect(length).toBe(0);
      await queue.end();
    });
  });
});
