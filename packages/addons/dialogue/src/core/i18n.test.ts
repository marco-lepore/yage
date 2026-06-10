import { describe, expect, it } from "vitest";

import { IdentityI18n, interpolate } from "./i18n.js";

describe("interpolate", () => {
  it("replaces known tokens and leaves unknown ones untouched", () => {
    expect(interpolate("hi {name}, {nope}", { name: "Mara" })).toBe(
      "hi Mara, {nope}",
    );
  });

  it("does not walk the prototype chain for token names", () => {
    // `{constructor}`/`{toString}` are inherited Object.prototype members, not
    // params — they must stay untouched like any other unknown token.
    expect(interpolate("{constructor}", {})).toBe("{constructor}");
    expect(interpolate("{toString} {valueOf} {hasOwnProperty}", {})).toBe(
      "{toString} {valueOf} {hasOwnProperty}",
    );
  });

  it("an own param shadowing a prototype name still interpolates", () => {
    expect(interpolate("{constructor}", { constructor: "X" })).toBe("X");
  });
});

describe("IdentityI18n", () => {
  it("returns the fallback, interpolating params", () => {
    const i18n = new IdentityI18n();
    expect(i18n.t("some.key", "hi {name}", { name: "Mara" })).toBe("hi Mara");
    expect(i18n.t(undefined, "plain")).toBe("plain");
  });
});
