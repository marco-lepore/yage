import { describe, expect, it } from "vitest";
import { interactionGroup, tuningNumbers } from "./validate.js";

describe("packed interaction groups", () => {
  it.each([-0x80000000, -1, 0, 0x7fffffff, 0xffffffff])(
    "accepts %s",
    (value) => {
      expect(() => interactionGroup("test", "groups", value)).not.toThrow();
    },
  );
  it.each([-0x80000001, 0x100000000, 0.5, NaN, Infinity, -Infinity])(
    "rejects %s",
    (value) => {
      expect(() => interactionGroup("test", "groups", value)).toThrow(
        /test: groups/,
      );
    },
  );
  it("retains nonnegative validation for ordinary tuning", () => {
    expect(() => tuningNumbers("test", { speed: -1 })).toThrow(/speed/);
  });
});
