#!/usr/bin/env ts-node

import { Queue, Scheduler, Worker } from "../src";
import { configureExampleEventLogging } from "./shared/logEvents";
/* In your projects:
import { Queue, Scheduler, Worker } from "node-resque";
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

// ///////////////////////////
// DEFINE YOUR WORKER TASKS //
// ///////////////////////////

const jobs = {
  add: {
    plugins: ["Retry"],
    pluginOptions: {
      Retry: {
        retryLimit: 3,
        // retryDelay: 1000,
        backoffStrategy: [1000 * 10, 1000 * 20, 1000 * 30],
      },
    },
    perform: function (a, b) {
      if (a < 0) {
        throw new Error("NEGATIVE NUMBERS ARE HARD :(");
      } else {
        return a + b;
      }
    },
  },
};

async function boot() {
  // /////////////////
  // START A WORKER //
  // /////////////////

  const worker = new Worker(
    { connection: connectionDetails, queues: ["math"] },
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

  // /////////////////////////////////
  // CONNECT TO A QUEUE AND WORK IT //
  // /////////////////////////////////

  const queue = new Queue({ connection: connectionDetails }, jobs);
  queue.on("error", function (error) {
    console.log(error);
  });
  await queue.connect();
  queue.enqueue("math", "add", [1, 2]);
  queue.enqueue("math", "add", [-1, 2]);
}

boot();
