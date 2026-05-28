import Redis from "ioredis";
import * as NodeResque from "../../src/index";
import { ConnectionOptions } from "../../src/types/options";

const namespace = `resque-test-${process.env.JEST_WORKER_ID || 0}`;
const queueName = "test_queue";
const pkg = "ioredis";

interface SpecConnectionDetails extends ConnectionOptions {
  pkg: string;
  host: string;
  password: string;
  port: number;
  database: number;
  namespace: string;
  options?: { [key: string]: any };
  redis?: Redis;
}

interface SpecHelper {
  pkg: string;
  namespace: string;
  queue: string;
  timeout: number;
  smallTimeout: number;
  redis: Redis;
  connectionDetails: SpecConnectionDetails;
  worker: NodeResque.Worker;
  scheduler: NodeResque.Scheduler;
  connect: () => Promise<void>;
  cleanup: () => Promise<void>;
  disconnect: () => Promise<void>;
  startAll: (jobs: NodeResque.Jobs) => Promise<void>;
  endAll: () => Promise<void>;
  popFromQueue: () => Promise<string | null>;
  cleanConnectionDetails: () => { database: number; namespace: string };
}

const SpecHelper = {
  pkg: pkg,
  namespace: namespace,
  queue: queueName,
  timeout: 500,
  smallTimeout: 3,
  redis: null as unknown as Redis,
  connectionDetails: {
    pkg: pkg,
    host: process.env.REDIS_HOST || "127.0.0.1",
    password: "",
    port: 6379,
    database: parseInt(process.env.JEST_WORKER_ID || "0"),
    namespace: namespace,
  } as SpecConnectionDetails,
  worker: null as unknown as NodeResque.Worker,
  scheduler: null as unknown as NodeResque.Scheduler,

  connect: async function (this: SpecHelper) {
    if (!this.connectionDetails.options) this.connectionDetails.options = {};
    this.connectionDetails.options.db = this.connectionDetails.database;
    this.redis = new Redis(
      this.connectionDetails.port,
      this.connectionDetails.host,
      this.connectionDetails.options,
    );

    this.redis.setMaxListeners(0);
    if (
      this.connectionDetails.password !== null &&
      this.connectionDetails.password !== ""
    ) {
      await this.redis.auth(this.connectionDetails.password);
    }
    await this.redis.select(this.connectionDetails.database);
    this.connectionDetails.redis = this.redis;
  },

  cleanup: async function (this: SpecHelper) {
    const keys = await this.redis.keys(this.namespace + "*");
    if (keys.length > 0) await this.redis.del(keys);
  },

  disconnect: async function (this: SpecHelper) {
    if (typeof this.redis.disconnect === "function") {
      this.redis.disconnect();
    } else if (typeof this.redis.quit === "function") {
      await this.redis.quit();
    }

    this.redis = null as unknown as Redis;
    delete this.connectionDetails.redis;
  },

  startAll: async function (this: SpecHelper, jobs: NodeResque.Jobs) {
    const Worker = NodeResque.Worker;
    const Scheduler = NodeResque.Scheduler;

    this.worker = new Worker(
      {
        connection: { redis: this.redis },
        queues: this.queue,
        timeout: this.timeout,
      },
      jobs,
    );
    await this.worker.connect();

    this.scheduler = new Scheduler({
      connection: { redis: this.redis },
      timeout: this.timeout,
    });

    await this.scheduler.connect();
  },

  endAll: async function (this: SpecHelper) {
    await this.worker.end();
    await this.scheduler.end();
  },

  popFromQueue: async function (this: SpecHelper) {
    return this.redis.lpop(this.namespace + ":queue:" + this.queue);
  },

  cleanConnectionDetails: function (this: SpecHelper) {
    interface connectionDetails {
      database: number;
      namespace: string;
    }

    const out: connectionDetails = {
      database: parseInt(process.env.JEST_WORKER_ID || "0"),
      namespace: namespace,
    };

    for (const i in this.connectionDetails) {
      if (i !== "redis") {
        //@ts-ignore
        out[i] = this.connectionDetails[i];
      }
    }

    return out;
  },
};

export default SpecHelper;
