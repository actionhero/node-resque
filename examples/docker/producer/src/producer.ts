import { Queue } from "node-resque";

/* In your projects:
import { Queue } from require("node-resque");
*/

let queue;

async function boot() {
  const connectionDetails = {
    pkg: "ioredis",
    host: process.env.REDIS_HOST,
  };

  queue = new Queue({ connection: connectionDetails });
  queue.on("error", function (error) {
    console.log(error);
  });

  await queue.connect();

  // keep adding jobs forever...
  setInterval(async () => {
    console.log(`adding jobs @ ${new Date()}`);
    await queue.enqueue("math", "add", [1, 2]);
    await queue.enqueue("math", "add", [2, 3]);
    await queue.enqueueIn(3000, "math", "subtract", [2, 1]);
  }, 1000);
}

async function shutdown() {
  await queue.end();
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
