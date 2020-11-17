#!/usr/bin/env ts-node

import { Plugin, Worker, Queue } from "../src";
import { configureExampleEventLogging } from "./shared/logEvents";
/* In your projects:
import { Worker, Scheduler, Queue } from "node-resque";
*/

// ////////////////////////
// SET UP THE CONNECTION //
// ////////////////////////

const connectionDetails = {
  pkg: "ioredis",
  host: "127.0.0.1",
  password: null,
  port: 6379,
  database: 0,
  // namespace: 'resque',
  // looping: true,
  // options: {password: 'abc'},
};

// ////////////////////
// BUILD THE PLUGIN //
// ////////////////////

class MyPlugin extends Plugin {
  constructor(...args) {
    // @ts-ignore
    super(...args);
    this.name = "MyPlugin";
  }

  beforePerform() {
    console.log(this.options.messagePrefix + " | " + JSON.stringify(this.args));
    return true;
  }

  beforeEnqueue() {
    return true;
  }
  afterEnqueue() {
    return true;
  }
  afterPerform() {
    return true;
  }
}

async function boot() {
  // ///////////////////////////
  // DEFINE YOUR WORKER TASKS //
  // ///////////////////////////

  let jobsToComplete = 0;

  const jobs = {
    jobby: {
      plugins: [MyPlugin],
      pluginOptions: {
        MyPlugin: { messagePrefix: "[🤡🤡🤡]" },
      },
      perform: (a, b) => {
        jobsToComplete--;
        tryShutdown();
      },
    },
  };

  // just a helper for this demo
  async function tryShutdown() {
    if (jobsToComplete === 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
      await worker.end();
      process.exit();
    }
  }

  // /////////////////
  // START A WORKER //
  // /////////////////

  const worker = new Worker(
    { connection: connectionDetails, queues: ["default"] },
    jobs
  );
  await worker.connect();
  worker.start();

  // //////////////////////
  // REGISTER FOR EVENTS //
  // //////////////////////

  configureExampleEventLogging({ worker });

  // /////////////////////
  // CONNECT TO A QUEUE //
  // /////////////////////

  const queue = new Queue({ connection: connectionDetails }, jobs);
  queue.on("error", function (error) {
    console.log(error);
  });
  await queue.connect();
  await queue.enqueue("default", "jobby", [1, 2]);
  jobsToComplete = 1;
}

boot();
