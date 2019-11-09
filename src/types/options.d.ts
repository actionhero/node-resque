/// <reference path="./../../node_modules/@types/ioredis/index.d.ts" />
import * as IORedis from 'ioredis'

export interface Options {
  options: Options
  pkg: string
  db: number
  database: number
  host: string
  port: number
  namespace: string
  redis: IORedis.Redis | null
  name: string | null
  queues: Array<string> | null
  timeout: number | null
  looping: boolean | null
}
