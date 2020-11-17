#!/usr/bin/env ts-node

import { Queue, Scheduler, Worker } from "../src";
import { configureExampleEventLogging } from "./shared/logEvents";
/* In your projects:
import { Queue, Scheduler, Worker } from "node-resque";
*/

async function boot() {
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

  // ///////////////////////////
  // DEFINE YOUR WORKER TASKS //
  // ///////////////////////////

  let jobsToComplete = 0;

  const jobs = {
    add: {
      plugins: ["JobLock"],
      pluginOptions: {
        JobLock: {},
      },
      perform: async (a, b) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
        jobsToComplete--;
        tryShutdown();

        const answer = a + b;
        return answer;
      },
    },
    subtract: {
      perform: (a, b) => {
        jobsToComplete--;
        tryShutdown();

        const answer = a - b;
        return answer;
      },
    },
  };

  // just a helper for this demo
  async function tryShutdown() {
    if (jobsToComplete === 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
      await scheduler.end();
      await worker.end();
      process.exit();
    }
  }

  // /////////////////
  // START A WORKER //
  // /////////////////

  const worker = new Worker(
    { connection: connectionDetails, queues: ["math", "otherQueue"] },
    jobs
  );
  await worker.connect();
  worker.start();

  // ////////////////////
  // START A SCHEDULER //
  // ////////////////////

  const scheduler = new Scheduler({ connection: connectionDetails });
  await scheduler.connect();
  scheduler.start();

  // //////////////////////
  // REGISTER FOR EVENTS //
  // //////////////////////

  configureExampleEventLogging({ worker, scheduler });

  // //////////////////////
  // CONNECT TO A QUEUE //
  // //////////////////////

  const queue = new Queue({ connection: connectionDetails }, jobs);
  queue.on("error", function (error) {
    console.log(error);
  });
  await queue.connect();
  await queue.enqueue("math", "add", [1, 2]);
  await queue.enqueue("math", "add", [1, 2]);
  await queue.enqueue("math", "add", [2, 3]);
  await queue.enqueueIn(3000, "math", "subtract", [2, 1]);
  jobsToComplete = 4;
}

boot();

// and when you are done
// await queue.end()
// await scheduler.end()
// await worker.end()
