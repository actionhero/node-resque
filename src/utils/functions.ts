import * as deepmerge from "deepmerge";
const Merge = require("deepmerge");

const combineMerge = (
  target: Array<any>,
  source: Array<any>,
  options: deepmerge.Options
) => {
  source.forEach((item, index) => {
    if (typeof target[index] === "undefined") {
      target[index] = item;
    } else if (options.isMergeableObject(item)) {
      target[index] = Merge(target[index], item, options);
    } else if (target.indexOf(item) === -1) {
      target.push(item);
    }
  });
  return target;
};

/**
 * Deep merge everything from the incoming (source) array
 * into the target array. If the target array is sealed
 * any attempt to add/remove a property or value will
 * raise a TypeError
 */
export function DeepMerge(target: Array<any>, source: Array<any>): Array<any> {
  return Merge(target, source, { arrayMerge: combineMerge });
}

/**
 * Deeply seals all objects within the input argument
 * and returns the result as a sealed, flattened array
 * for use as plugin or job args
 */
export function LockArgs<T>(
  arg: T | T[] | { [key: string]: any },
  arrayify: boolean = true
): any {
  if (arrayify) {
    arg = [arg].flat() as T[];
  }

  if (Array.isArray(arg)) {
    arg = arg.map((i: any) => LockArgs(i, false));
  } else if (Object.prototype.toString.call(arg) === "[object Object]") {
    arg = Object.keys(arg).reduce(
      (obj: { [key: string]: any }, key: string): T => {
        return Object.assign(obj, {
          [key]: LockArgs((arg as { [key: string]: any })[key], false),
        }) as T;
      },
      {}
    ) as { [key: string]: any };
  }

  return Object.seal(arg);
}
