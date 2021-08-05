import * as IORedis from "ioredis";
import { Connection } from "..";

export interface ConnectionOptions {
  pkg?: string;
  host?: string;
  port?: number;
  database?: number;
  namespace?: string;
  looping?: boolean;
  options?: any;
  redis?: IORedis.Redis | IORedis.Cluster;
  scanCount?: number;
}

export interface WorkerOptions extends ConnectionOptions {
  name?: string;
  queues?: Array<string> | string;
  timeout?: number;
  looping?: boolean;
  id?: number;
  connection?: Connection;
}

export interface SchedulerOptions extends ConnectionOptions {
  name?: string;
  timeout?: number;
  leaderLockTimeout: number;
  stuckWorkerTimeout: number;
  retryStuckJobs: boolean;
  connection?: Connection;
}

export interface MultiWorkerOptions extends ConnectionOptions {
  name?: string;
  queues?: Array<string>;
  timeout?: number;
  maxEventLoopDelay?: number;
  checkTimeout?: number;
  connection?: Connection;
  minTaskProcessors?: number;
  maxTaskProcessors?: number;
}

export interface Job<T> {
  plugins?: string[];
  pluginOptions?: { [pluginName: string]: any };
  perform: (...args: any[]) => Promise<T>;
}
