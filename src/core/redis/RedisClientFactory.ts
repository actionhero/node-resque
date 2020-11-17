import { ConnectionOptions } from "../..";
import * as IORedis from "ioredis";

export class RedisClientFactory {
  static create(options: ConnectionOptions): IORedis.Redis | IORedis.Cluster {
    if (options.redis) {
      return options.redis;
    }

    const Pkg = require(options.pkg);
    if (typeof Pkg.createClient === "function" && options.pkg !== "ioredis") {
      return Pkg.createClient(
        options.port,
        options.host,
        options.options
      );
    }

    options.options.db = options.database;
    return new Pkg(
      options.port,
      options.host,
      options.options
    );
  }
}
