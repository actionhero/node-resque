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

  const jobs = {
    stuck: {
      perform: async function () {
        console.log(`${this.name} is starting stuck job...`);
        await new Promise((resolve) => {
          clearTimeout(this.pingTimer); // stop the worker from checkin in, like the process crashed
          setTimeout(resolve, 60 * 60 * 1000); // 1 hour job
        });
      },
    },
  };

  // /////////////////
  // START A WORKER //
  // /////////////////

  const worker = new Worker(
    { connection: connectionDetails, queues: ["stuckJobs"] },
    jobs
  );
  await worker.connect();
  worker.start();

  // ////////////////////
  // START A SCHEDULER //
  // ////////////////////

  const scheduler = new Scheduler({
    stuckWorkerTimeout: 10 * 1000,
    connection: connectionDetails,
  });

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
  await queue.enqueue("stuckJobs", "stuck", ["oh no"]);
}

boot();
