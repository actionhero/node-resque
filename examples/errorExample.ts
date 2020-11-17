#!/usr/bin/env ts-node

import { Queue, Worker } from "../src";
import { configureExampleEventLogging } from "./shared/logEvents";
/* In your projects:
import { Queue, Worker } from "node-resque";
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
  // // options: {password: 'abc'},
};

async function boot() {
  // ///////////////////////////
  // DEFINE YOUR WORKER TASKS //
  // ///////////////////////////

  let jobsToComplete = 0;

  const jobs = {
    brokenJob: {
      plugins: [],
      pluginOptions: {},
      perform: function (a, b) {
        jobsToComplete--;
        tryShutdown();

        throw new Error("broken message from job");
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
  await queue.connect();
  await queue.enqueue("default", "brokenJob", [1, 2]);
  jobsToComplete = 1;
}

boot();
