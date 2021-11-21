import * as IORedis from "ioredis";

export interface ConnectionOptions {
  pkg?: string;
  host?: string;
  port?: number;
  database?: number;
  namespace?: string | string[];
  looping?: boolean;
  options?: any;
  redis?: IORedis.Redis | IORedis.Cluster;
  scanCount?: number;
}

export interface QueueOptions extends ConnectionOptions {
  connection?: ConnectionOptions;
  queue?: string | string[];
}

export interface WorkerOptions extends ConnectionOptions {
  name?: string;
  queues?: Array<string> | string;
  timeout?: number;
  looping?: boolean;
  id?: number;
  connection?: ConnectionOptions;
}

export interface SchedulerOptions extends ConnectionOptions {
  name?: string;
  timeout?: number;
  leaderLockTimeout?: number;
  stuckWorkerTimeout?: number;
  retryStuckJobs?: boolean;
  connection?: ConnectionOptions;
}

export interface MultiWorkerOptions extends ConnectionOptions {
  name?: string;
  queues?: Array<string>;
  timeout?: number;
  maxEventLoopDelay?: number;
  checkTimeout?: number;
  connection?: ConnectionOptions;
  minTaskProcessors?: number;
  maxTaskProcessors?: number;
}

// Re-export for backward compatibility
export { Job } from "./job";
