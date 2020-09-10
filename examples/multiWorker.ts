#!/usr/bin/env ts-node

import { MultiWorker, Queue } from "../src";
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

  // normal worker emitters
  multiWorker.on("start", (workerId) => {
    console.log(`worker[${workerId}] started`);
  });
  multiWorker.on("end", (workerId) => {
    console.log(`worker[${workerId}] ended`);
  });
  multiWorker.on("cleaning_worker", (workerId, worker, pid) => {
    console.log("cleaning old worker " + worker);
  });
  multiWorker.on("poll", (workerId, queue) => {
    console.log(`worker[${workerId}] polling ${queue}`);
  });
  multiWorker.on("job", (workerId, queue, job) => {
    console.log(
      `worker[${workerId}] working job ${queue} ${JSON.stringify(job)}`
    );
  });
  multiWorker.on("reEnqueue", (workerId, queue, job, plugin) => {
    console.log(
      `worker[${workerId}] reEnqueue job (${plugin}) ${queue} ${JSON.stringify(
        job
      )}`
    );
  });
  multiWorker.on("success", (workerId, queue, job, result, duration) => {
    console.log(
      `worker[${workerId}] job success ${queue} ${JSON.stringify(
        job
      )} >> ${result} (${duration}ms)`
    );
  });
  multiWorker.on("failure", (workerId, queue, job, failure, duration) => {
    console.log(
      `worker[${workerId}] job failure ${queue} ${JSON.stringify(
        job
      )} >> ${failure} (${duration}ms)`
    );
  });
  multiWorker.on("error", (error, workerId, queue, job) => {
    console.log(
      `worker[${workerId}] error ${queue} ${JSON.stringify(job)} >> ${error}`
    );
  });
  multiWorker.on("pause", (workerId) => {
    console.log(`worker[${workerId}] paused`);
  });

  // multiWorker emitters
  multiWorker.on("multiWorkerAction", (verb, delay) => {
    console.log(
      `*** checked for worker status: ${verb} (event loop delay: ${delay}ms)`
    );
  });

  multiWorker.start();

  process.on("SIGINT", async () => {
    await multiWorker.stop();
    console.log("*** ALL STOPPED ***");
    process.exit();
  });
}

boot();
