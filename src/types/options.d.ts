/// <reference path="./../../node_modules/@types/ioredis/index.d.ts" />
import * as IORedis from "ioredis";
import { Connection } from "../core/connection";

export interface Options {
  options: Options;
  pkg: string;
  db: number;
  database: number;
  host: string;
  port: number;
  namespace: string;
  redis?: IORedis.Redis | null;

  // worker
  name?: string | null;
  queues?: Array<string> | null;
  timeout?: number | null;
  looping?: boolean | null;

  // scheduler
  masterLockTimeout: number | null;
  stuckWorkerTimeout: number | null;

  // multiWorker
  maxEventLoopDelay: number | null;
  checkTimeout: number | null;
  connection: Connection | null;
  minTaskProcessors: number | null;
  maxTaskProcessors: number | null;
}
