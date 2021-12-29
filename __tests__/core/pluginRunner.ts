import specHelper from "../utils/specHelper";
import { Queue, Worker, Job } from "../../src";
import { HooksPlugin } from "../utils/custom-plugin";
import { RunPlugins } from "../../src/core/pluginRunner";

describe("plugin runner", () => {
  const jobs = {
    //@ts-ignore
    myJob: {
      plugins: [HooksPlugin],
      perform: async () => {
        throw new Error("should not get here");
      },
    } as Job<any>,
  };

  describe("queue hooks", () => {
    const queue = new Queue(
      {
        connection: specHelper.cleanConnectionDetails(),
        queue: specHelper.queue,
      },
      jobs
    );

    describe("beforeEnqueue", () => {
      test("it will not permit adding properties to args", async () => {
        HooksPlugin.prototype.beforeEnqueue = async function () {
          this.args.push(3);
          return true;
        };

        await expect(
          RunPlugins(
            queue,
            "beforeEnqueue",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [1, 2]
          )
        ).rejects.toThrow(TypeError);
      });

      test("it will not permit adding properties to nested args", async () => {
        HooksPlugin.prototype.beforeEnqueue = async function () {
          this.args[0].a.b = true;
          return true;
        };

        await expect(
          RunPlugins(
            queue,
            "beforeEnqueue",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [{ a: {} }]
          )
        ).rejects.toThrow(TypeError);
      });
    });

    describe("afterEnqueue", () => {
      test("it will not permit adding properties to args", async () => {
        HooksPlugin.prototype.afterEnqueue = async function () {
          this.args.push(3);
          return true;
        };

        await expect(
          RunPlugins(
            queue,
            "afterEnqueue",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [1, 2]
          )
        ).rejects.toThrow(TypeError);
      });

      test("it will not permit adding properties to nested args", async () => {
        HooksPlugin.prototype.afterEnqueue = async function () {
          this.args[0].a.b = true;
          return true;
        };

        await expect(
          RunPlugins(
            queue,
            "afterEnqueue",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [{ a: {} }]
          )
        ).rejects.toThrow(TypeError);
      });
    });

    describe("beforeDelayEnqueue", () => {
      test("it will not permit adding properties to args", async () => {
        HooksPlugin.prototype.beforeDelayEnqueue = async function () {
          this.args.push(3);
          return true;
        };

        await expect(
          RunPlugins(
            queue,
            "beforeDelayEnqueue",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [1, 2]
          )
        ).rejects.toThrow(TypeError);
      });

      test("it will not permit adding properties to nested args", async () => {
        HooksPlugin.prototype.beforeDelayEnqueue = async function () {
          this.args[0].a.b = true;
          return true;
        };

        await expect(
          RunPlugins(
            queue,
            "beforeDelayEnqueue",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [{ a: {} }]
          )
        ).rejects.toThrow(TypeError);
      });
    });

    describe("afterDelayEnqueue", () => {
      test("it will not permit adding properties to args", async () => {
        HooksPlugin.prototype.afterDelayEnqueue = async function () {
          this.args.push(3);
          return true;
        };

        await expect(
          RunPlugins(
            queue,
            "afterDelayEnqueue",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [1, 2]
          )
        ).rejects.toThrow(TypeError);
      });

      test("it will not permit adding properties to nested args", async () => {
        HooksPlugin.prototype.afterDelayEnqueue = async function () {
          this.args[0].a.b = true;
          return true;
        };

        await expect(
          RunPlugins(
            queue,
            "afterDelayEnqueue",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [{ a: {} }]
          )
        ).rejects.toThrow(TypeError);
      });
    });
  });

  describe("worker hooks", () => {
    const worker = new Worker(
      { connection: specHelper.connectionDetails, queues: [specHelper.queue] },
      {}
    );

    describe("beforePerform", () => {
      test("it will not permit adding properties to args", async () => {
        HooksPlugin.prototype.beforePerform = async function () {
          this.args.push(3);
          return true;
        };

        await expect(
          RunPlugins(
            worker,
            "beforePerform",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [1, 2]
          )
        ).rejects.toThrow(TypeError);
      });

      test("it will not permit adding properties to nested args", async () => {
        HooksPlugin.prototype.beforePerform = async function () {
          this.args[0].a.b = true;
          return true;
        };

        await expect(
          RunPlugins(
            worker,
            "beforePerform",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [{ a: {} }]
          )
        ).rejects.toThrow(TypeError);
      });
    });

    describe("afterPerform", () => {
      test("it will not permit adding properties to args", async () => {
        HooksPlugin.prototype.afterPerform = async function () {
          this.args.push(3);
          return true;
        };

        await expect(
          RunPlugins(
            worker,
            "afterPerform",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [1, 2]
          )
        ).rejects.toThrow(TypeError);
      });

      test("it will not permit adding properties to nested args", async () => {
        HooksPlugin.prototype.afterPerform = async function () {
          this.args[0].a.b = true;
          return true;
        };

        await expect(
          RunPlugins(
            worker,
            "afterPerform",
            "myJob",
            specHelper.queue,
            jobs.myJob,
            [{ a: {} }]
          )
        ).rejects.toThrow(TypeError);
      });
    });
  });
});
