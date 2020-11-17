/// <reference path="./../../node_modules/@types/ioredis/index.d.ts" />

import { EventEmitter } from "events";
import * as IORedis from "ioredis";
import * as fs from "fs";
import * as path from "path";
import { ConnectionOptions } from "..";

interface EventListeners {
  [key: string]: Function;
}

export class Connection extends EventEmitter {
  options: ConnectionOptions | null;
  private eventListeners: EventListeners;
  connected: boolean;
  redis: IORedis.Redis | IORedis.Cluster;

  constructor(options: ConnectionOptions = {}) {
    super();

    const defaults = {
      pkg: "ioredis",
      host: "127.0.0.1",
      port: 6379,
      database: 0,
      namespace: "resque",
      options: {},
      scanCount: 10,
    };

    for (const i in defaults) {
      if (options[i] === null || options[i] === undefined) {
        options[i] = defaults[i];
      }
    }

    this.options = options;
    this.eventListeners = {};
    this.connected = false;
  }

  async connect() {
    const connectionTestAndLoadLua = async () => {
      try {
        await this.redis.set(this.key("connection_test_key"), "ok");
        const data = await this.redis.get(this.key("connection_test_key"));
        if (data !== "ok") {
          throw new Error("cannot read connection test key");
        }
        this.connected = true;
        this.loadLua();
      } catch (error) {
        this.connected = false;
        this.emit("error", error);
      }
    };

    if (this.options.redis) {
      this.redis = this.options.redis;
      await connectionTestAndLoadLua();
    } else {
      const Pkg = require(this.options.pkg);
      if (
        typeof Pkg.createClient === "function" &&
        this.options.pkg !== "ioredis"
      ) {
        this.redis = Pkg.createClient(
          this.options.port,
          this.options.host,
          this.options.options
        );
      } else {
        this.options.options.db = this.options.database;
        this.redis = new Pkg(
          this.options.port,
          this.options.host,
          this.options.options
        );
      }
    }

    this.eventListeners.error = (error) => {
      this.emit("error", error);
    };
    this.eventListeners.end = () => {
      this.connected = false;
    };
    this.redis.on("error", (err) => this.eventListeners.error(err));
    this.redis.on("end", () => this.eventListeners.end());

    if (!this.options.redis && typeof this.redis.select === "function") {
      await this.redis.select(this.options.database);
    }

    await connectionTestAndLoadLua();
  }

  loadLua() {
    // even though ioredis-mock can run LUA, cjson is not available
    if (this.options.pkg === "ioredis-mock") return;

    const luaDir = path.join(__dirname, "..", "..", "lua");

    const files = fs.readdirSync(luaDir);
    for (const file of files) {
      const { name } = path.parse(file);
      const contents = fs.readFileSync(path.join(luaDir, file)).toString();
      const lines = contents.split("\n"); // see https://github.com/actionhero/node-resque/issues/465 for why we split only on *nix line breaks
      const encodedMetadata = lines[0].replace(/^-- /, "");
      const metadata = JSON.parse(encodedMetadata);

      this.redis.defineCommand(name, {
        numberOfKeys: metadata.numberOfKeys,
        lua: contents,
      });
    }
  }

  async getKeys(match: string, count: number = null, keysAry = [], cursor = 0) {
    if (count === null || count === undefined) {
      count = this.options.scanCount || 10;
    }

    if (this.redis && typeof this.redis.scan === "function") {
      const [newCursor, matches] = await this.redis.scan(
        cursor,
        "match",
        match,
        "count",
        count
      );
      if (matches && matches.length > 0) {
        keysAry = keysAry.concat(matches);
      }

      if (newCursor === "0") {
        return keysAry;
      }

      return this.getKeys(match, count, keysAry, parseInt(newCursor));
    }

    this.emit(
      "error",
      new Error(
        "You must establish a connection to redis before running the getKeys command."
      )
    );
  }

  end() {
    Object.keys(this.listeners).forEach((eventName) => {
      this.redis.removeListener(eventName, this.listeners[eventName]);
    });

    // Only disconnect if we established the redis connection on our own.
    if (!this.options.redis && this.connected) {
      if (typeof this.redis.disconnect === "function") {
        this.redis.disconnect();
      }
      if (typeof this.redis.quit === "function") {
        this.redis.quit();
      }
    }

    this.connected = false;
  }

  key(arg: any, arg2?: any, arg3?: any, arg4?: any) {
    let args;
    args = arguments.length >= 1 ? [].slice.call(arguments, 0) : [];
    if (Array.isArray(this.options.namespace)) {
      args.unshift(...this.options.namespace);
    } else {
      args.unshift(this.options.namespace);
    }
    args = args.filter((e) => {
      return String(e).trim();
    });
    return args.join(":");
  }
}
