import { Job } from "../types/job";
import { Worker } from "./worker";
import { Queue } from "./queue";
import { Plugin } from "./plugin";

type PluginConstructor<T> = new (...args: any[]) => T & {
  [key: string]: Plugin;
};

export async function RunPlugins(
  self: Queue | Worker,
  type: string,
  func: string,
  queue: string,
  job: Job<unknown>,
  args: Array<any>,
  pluginCounter?: number
): Promise<boolean> {
  if (!job) return true;
  if (!pluginCounter) pluginCounter = 0;
  if (
    job.plugins === null ||
    job.plugins === undefined ||
    job.plugins.length === 0
  ) {
    return true;
  }
  if (pluginCounter >= job.plugins.length) return true;

  const pluginRefrence = job.plugins[pluginCounter];
  const toRun = await RunPlugin(
    self,
    pluginRefrence,
    type,
    func,
    queue,
    job,
    args
  );
  pluginCounter++;
  if (toRun === false) return false;

  return RunPlugins(self, type, func, queue, job, args, pluginCounter);
}

export async function RunPlugin(
  self: Queue | Worker,
  PluginReference: string | PluginConstructor<unknown>,
  type: string,
  func: string,
  queue: string,
  job: Job<unknown>,
  args: Array<any>
): Promise<boolean> {
  if (!job) return true;

  let pluginName: string;
  if (typeof PluginReference === "function") {
    // @ts-ignore
    pluginName = new PluginReference(self, func, queue, job, args, {}).name;
  } else if (typeof pluginName === "function") {
    pluginName = pluginName["name"];
  }

  let pluginOptions = null;

  if (
    self.jobs[func].pluginOptions &&
    self.jobs[func].pluginOptions[pluginName]
  ) {
    pluginOptions = self.jobs[func].pluginOptions[pluginName];
  } else {
    pluginOptions = {};
  }

  let plugin: { [key: string]: Plugin };
  if (typeof PluginReference === "string") {
    const PluginConstructor = require(`./../plugins/${PluginReference}`)[
      PluginReference
    ];
    plugin = new PluginConstructor(self, func, queue, job, args, pluginOptions);
  } else if (typeof PluginReference === "function") {
    // @ts-ignore
    plugin = new PluginReference(self, func, queue, job, args, pluginOptions);
  } else {
    throw new Error("Plugin must be the constructor name or an object");
  }

  if (
    plugin[type] === null ||
    plugin[type] === undefined ||
    typeof plugin[type] !== "function"
  ) {
    return true;
  }

  // @ts-ignore
  return plugin[type]();
}
