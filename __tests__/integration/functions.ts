import { LockArgs, DeepMerge } from "../../src/utils/functions";

describe("utility helpers", () => {
  describe("LockArgs", () => {
    test("should return an array", () => {
      expect(LockArgs({ a: 1 })).toEqual([{ a: 1 }]);
    });

    test("should return a sealed array", () => {
      const locked = LockArgs({ a: 1 });
      expect(Object.isSealed(locked)).toEqual(true);
    });

    test("should seal nested property values", () => {
      const locked = LockArgs({ a: [{ b: true }] });
      expect(Object.isSealed(locked[0].a[0].b)).toEqual(true);
    });
  });

  describe("DeepMerge", () => {
    test("should override existing properties on target object", () => {
      const target = [{ a: 1, b: 2 }];
      const merge = [{ a: 8, c: 3 }];
      expect(DeepMerge(target, merge)).toEqual([{ a: 8, b: 2, c: 3 }]);
    });

    test("should override existing nested properties on target object", () => {
      const target = [{ a: [{ b: 1 }] }];
      const merge = [{ a: [{ b: 2 }] }, "new property"];
      expect(DeepMerge(target, merge)).toEqual([
        { a: [{ b: 2 }] },
        "new property",
      ]);
    });
  });
});
