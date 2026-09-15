import { describe, expect, it } from "vitest";
import { formatFallback, formatText, isMessage, msg } from "./message.js";

describe("msg", () => {
  it("returns a frozen descriptor with frozen values", () => {
    const m = msg("hello", "Hello {name}", { name: "Mina" });
    expect(m).toEqual({
      key: "hello",
      fallback: "Hello {name}",
      values: { name: "Mina" },
    });
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.values)).toBe(true);
    expect("values" in msg("plain", "Plain")).toBe(false);
  });

  it("rejects an empty key, a non-string fallback, and unsupported values", () => {
    expect(() => msg("", "x")).toThrow("non-empty");
    expect(() => msg("k", 1 as unknown as string)).toThrow("must be a string");
    expect(() => msg("k", "x", { bad: {} as unknown as string })).toThrow(
      "values",
    );
    expect(() => msg("k", "x", { bad: Number.NaN })).toThrow("values");
  });
});

describe("isMessage", () => {
  it("accepts the message shape and rejects the rest", () => {
    expect(isMessage(msg("k", "f"))).toBe(true);
    expect(isMessage({ key: "k", fallback: "f", values: { n: 1 } })).toBe(true);
    expect(isMessage({ key: "", fallback: "f" })).toBe(false);
    expect(isMessage({ key: "k" })).toBe(false);
    expect(isMessage("k")).toBe(false);
    expect(isMessage(null)).toBe(false);
  });
});

describe("formatText", () => {
  it("interpolates own values and leaves unknown and inherited tokens alone", () => {
    expect(formatText("Hi {name}, {nope}", { name: "Mina" })).toBe(
      "Hi Mina, {nope}",
    );
    expect(formatText("{constructor} {toString}", { x: 1 })).toBe(
      "{constructor} {toString}",
    );
    expect(formatText("{count} left", { count: 0 })).toBe("0 left");
    expect(formatText("no values")).toBe("no values");
  });
});

describe("formatFallback", () => {
  it("interpolates call values over the message's own values", () => {
    const m = msg("hp", "HP {hp}/{max}", { hp: 1, max: 10 });
    expect(formatFallback(m)).toBe("HP 1/10");
    expect(formatFallback(m, { hp: 7 })).toBe("HP 7/10");
  });
});
