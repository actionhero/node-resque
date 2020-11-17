import { Worker, Scheduler, MultiWorker } from "../../src";

export function configureExampleEventLogging({
  worker,
  scheduler,
  multiWorker,
}: {
  worker?: Worker;
  scheduler?: Scheduler;
  multiWorker?: MultiWorker;
}) {
  if (worker) {
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
        `job success ${queue} ${JSON.stringify(
          job
        )} >> ${result} (${duration}ms)`
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
  }

  if (scheduler) {
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
        `scheduler enquing job ${timestamp} >> ${JSON.stringify(job)}`
      );
    });
  }

  if (multiWorker) {
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
  }
}
