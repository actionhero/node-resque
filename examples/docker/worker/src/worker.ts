import { Worker, Scheduler } from "node-resque";

/* In your projects:
const { Worker, Scheduler } = require("node-resque");
*/

let worker;
let scheduler;

async function boot() {
  const connectionDetails = {
    pkg: "ioredis",
    host: process.env.REDIS_HOST,
  };

  const jobs = {
    add: {
      perform: async (a, b) => {
        const answer = a + b;
        return answer;
      },
    },
    subtract: {
      perform: (a, b) => {
        const answer = a - b;
        return answer;
      },
    },
  };

  worker = new Worker(
    { connection: connectionDetails, queues: ["math", "otherQueue"] },
    jobs
  );
  await worker.connect();
  worker.start();

  worker.on("start", () => {
    console.log("worker started");
  });
  worker.on("end", () => {
    console.log("worker ended");
  });
  worker.on("cleaning_worker", (worker, pid) => {
    console.log(`cleaning old worker ${worker}`);
  });
  worker.on("poll", (queue) => {
    console.log(`worker polling ${queue}`);
  });
  worker.on("ping", (time) => {
    console.log(`worker check in @ ${time}`);
  });
  worker.on("job", (queue, job) => {
    console.log(`working job ${queue} ${JSON.stringify(job)}`);
  });
  worker.on("reEnqueue", (queue, job, plugin) => {
    console.log(`reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`);
  });
  worker.on("success", (queue, job, result, duration) => {
    console.log(
      `job success ${queue} ${JSON.stringify(job)} >> ${result} (${duration}ms)`
    );
  });
  worker.on("failure", (queue, job, failure, duration) => {
    console.log(
      `job failure ${queue} ${JSON.stringify(
        job
      )} >> ${failure} (${duration}ms)`
    );
  });
  worker.on("error", (error, queue, job) => {
    console.log(`error ${queue} ${JSON.stringify(job)}  >> ${error}`);
  });
  worker.on("pause", () => {
    console.log("worker paused");
  });

  scheduler = new Scheduler({ connection: connectionDetails });
  await scheduler.connect();
  scheduler.start();

  scheduler.on("start", () => {
    console.log("scheduler started");
  });
  scheduler.on("end", () => {
    console.log("scheduler ended");
  });
  scheduler.on("poll", () => {
    console.log("scheduler polling");
  });
  scheduler.on("leader", () => {
    console.log("scheduler became leader");
  });
  scheduler.on("error", (error) => {
    console.log(`scheduler error >> ${error}`);
  });
  scheduler.on("cleanStuckWorker", (workerName, errorPayload, delta) => {
    console.log(
      `failing ${workerName} (stuck for ${delta}s) and failing job ${errorPayload}`
    );
  });
  scheduler.on("workingTimestamp", (timestamp) => {
    console.log(`scheduler working timestamp ${timestamp}`);
  });
  scheduler.on("transferredJob", (timestamp, job) => {
    console.log(
      `scheduler enqueuing job ${timestamp} >> ${JSON.stringify(job)}`
    );
  });
}

async function shutdown() {
  await scheduler.end();
  await worker.end();
  console.log(`processes gracefully stopped`);
}

function awaitHardStop() {
  const timeout = process.env.SHUTDOWN_TIMEOUT
    ? parseInt(process.env.SHUTDOWN_TIMEOUT)
    : 1000 * 30;
  return setTimeout(() => {
    console.error(
      `Process did not terminate within ${timeout}ms. Stopping now!`
    );
    process.nextTick(() => process.exit(1));
  }, timeout);
}

// handle errors & rejections
process.on("uncaughtException", (error) => {
  console.error(error.stack);
  process.nextTick(() => process.exit(1));
});

process.on("unhandledRejection", (rejection) => {
  console.error(rejection["stack"]);
  process.nextTick(() => process.exit(1));
});

// handle signals
process.on("SIGINT", async () => {
  console.log(`[ SIGNAL ] - SIGINT`);
  let timer = awaitHardStop();
  await shutdown();
  clearTimeout(timer);
});

process.on("SIGTERM", async () => {
  console.log(`[ SIGNAL ] - SIGTERM`);
  let timer = awaitHardStop();
  await shutdown();
  clearTimeout(timer);
});

process.on("SIGUSR2", async () => {
  console.log(`[ SIGNAL ] - SIGUSR2`);
  let timer = awaitHardStop();
  await shutdown();
  clearTimeout(timer);
});

boot();
