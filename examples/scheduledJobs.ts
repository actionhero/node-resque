#!/usr/bin/env ts-node

// We'll use https://github.com/tejasmanohar/node-schedule for this example,
// but there are many other excellent node scheduling projects
import * as schedule from "node-schedule";
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

async function boot() {
  // ///////////////////////////
  // DEFINE YOUR WORKER TASKS //
  // ///////////////////////////

  const jobs = {
    ticktock: (time, callback) => {
      console.log(`*** THE TIME IS ${time} ***`);
      return true;
    },
  };

  // /////////////////
  // START A WORKER //
  // /////////////////

  const worker = new Worker(
    { connection: connectionDetails, queues: ["time"] },
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

  // //////////////
  // DEFINE JOBS //
  // //////////////

  const queue = new Queue({ connection: connectionDetails }, jobs);
  queue.on("error", function (error) {
    console.log(error);
  });
  await queue.connect();
  schedule.scheduleJob("0,10,20,30,40,50 * * * * *", async () => {
    // do this job every 10 seconds, cron style
    // we want to ensure that only one instance of this job is scheduled in our enviornment at once,
    // no matter how many schedulers we have running
    if (scheduler.leader) {
      console.log(">>> enquing a job");
      await queue.enqueue("time", "ticktock", [new Date().toString()]);
    }
  });

  // ////////////////////
  // SHUTDOWN HELPERS //
  // ////////////////////

  const shutdown = async () => {
    await scheduler.end();
    await worker.end();
    console.log("bye.");
    process.exit();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

boot();
