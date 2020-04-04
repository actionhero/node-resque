#!/usr/bin/env ts-node

import { Worker } from "../src";
/* In your projects:
import { Worker } from "node-resque";
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
    add: {
      plugins: [],
      pluginOptions: {
        JobLock: {},
      },
      perform: async (a, b) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
        const answer = a + b;
        return answer;
      },
    },
  };

  // //////////////////////////////
  // BUILD A WORKER & WORK A JOB //
  // //////////////////////////////

  var worker = new Worker(
    { connection: connectionDetails, queues: ["math", "otherQueue"] },
    jobs
  );
  await worker.connect();

  let result;

  result = await worker.performInline("add", [1, 2]);
  console.log("Result: " + result);

  result = await worker.performInline("add", [5, 8]);
  console.log("Result: " + result);

  process.exit();
}

boot();
