/// <reference path="./../../node_modules/@types/ioredis/index.d.ts" />
import * as IORedis from "ioredis";
import { Connection } from "../core/connection";

export interface ConnectionOptions {
  options: ConnectionOptions;
  pkg: string;
  db: number;
  database: number;
  host: string;
  port: number;
  namespace: string;
  redis?: IORedis.Redis | null;
}

export interface WorkerOptions extends ConnectionOptions {
  name?: string | null;
  queues?: Array<string> | null;
  timeout?: number | null;
  looping?: boolean | null;
}

export interface SchedulerOptions extends ConnectionOptions {
  name?: string | null;
  timeout?: number | null;
  masterLockTimeout: number | null;
  stuckWorkerTimeout: number | null;
}

export interface MultiWorkerOptions extends ConnectionOptions {
  name?: string | null;
  queues?: Array<string> | null;
  timeout?: number | null;
  maxEventLoopDelay: number | null;
  checkTimeout: number | null;
  connection: Connection | null;
  minTaskProcessors: number | null;
  maxTaskProcessors: number | null;
}
