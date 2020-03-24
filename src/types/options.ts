/// <reference path="./../../node_modules/@types/ioredis/index.d.ts" />
import * as IORedis from "ioredis";
import { Connection } from "../core/connection";

export interface ConnectionOptions {
  pkg?: string;
  host?: string;
  port?: number;
  database?: number;
  namespace?: string;
  looping?: boolean;
  options?: any;
  redis?: IORedis.Redis;
  scanCount?: number;
}

export interface WorkerOptions extends ConnectionOptions {
  name?: string;
  queues?: Array<string>;
  timeout?: number;
  looping?: boolean;
}

export interface SchedulerOptions extends ConnectionOptions {
  name?: string;
  timeout?: number;
  leaderLockTimeout: number;
  stuckWorkerTimeout: number;
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

export interface Job<TResult> {
  plugins?: string[];
  pluginOptions?: { [pluginName: string]: any };
  perform: (...args: any[]) => Promise<TResult>;
}
