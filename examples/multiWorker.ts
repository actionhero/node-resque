#!/usr/bin/env ts-node

import { MultiWorker, Queue } from "../src";
import { configureExampleEventLogging } from "./shared/logEvents";
/* In your projects:
import { MultiWorker, Queue } from "node-resque";
*/

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

// Or, to share a single connection connection

// const ioredis = require('ioredis');
// const connectionDetails = { redis: new ioredis() };

async function boot() {
  // //////////////
  // DEFINE JOBS //
  // //////////////

  const blockingSleep = function (naptime) {
    const now = new Date();
    const startingMSeconds = now.getTime();
    let sleeping = true;
    let alarm;
    while (sleeping) {
      alarm = new Date();
      const alarmMSeconds = alarm.getTime();
      if (alarmMSeconds - startingMSeconds > naptime) {
        sleeping = false;
      }
    }
  };

  const jobs = {
    slowSleepJob: {
      plugins: [],
      pluginOptions: {},
      perform: async () => {
        const start = new Date().getTime();
        await new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
        return new Date().getTime() - start;
      },
    },
    slowCPUJob: {
      plugins: [],
      pluginOptions: {},
      perform: async () => {
        const start = new Date().getTime();
        blockingSleep(1000);
        return new Date().getTime() - start;
      },
    },
  };

  // ////////////////
  // ENQUEUE TASKS //
  // ////////////////

  const queue = new Queue({ connection: connectionDetails }, jobs);
  await queue.connect();
  let i = 0;
  while (i < 10) {
    await queue.enqueue("slowQueue", "slowCPUJob", []);
    i++;
  }

  i = 0;
  while (i < 100) {
    await queue.enqueue("slowQueue", "slowSleepJob", []);
    i++;
  }

  // ///////
  // WORK //
  // ///////

  const multiWorker = new MultiWorker(
    {
      connection: connectionDetails,
      queues: ["slowQueue"],
    },
    jobs
  );

  configureExampleEventLogging({ multiWorker });

  multiWorker.start();

  process.on("SIGINT", async () => {
    await multiWorker.stop();
    console.log("*** ALL STOPPED ***");
    process.exit();
  });
}

boot();
