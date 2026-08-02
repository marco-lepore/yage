import { describe, expect, it } from "vitest";
import {
  coerceControlValue,
  control,
  controlDefaults,
  type ControlSchema,
} from "./controls.js";

describe("control.number", () => {
  it("keeps the declared value and range", () => {
    expect(control.number(40, { min: 5, max: 200, label: "speed" })).toEqual({
      kind: "number",
      value: 40,
      min: 5,
      max: 200,
      step: 0.01,
      label: "speed",
    });
  });

  it("derives a range that contains the value", () => {
    expect(control.number(7)).toMatchObject({ min: 0, max: 14 });
    expect(control.number(0)).toMatchObject({ min: 0, max: 1 });
    expect(control.number(-5)).toMatchObject({ min: -5, max: 1 });
    expect(control.number(0.25)).toMatchObject({ min: 0, max: 1 });
  });

  it("takes only the bound that was given", () => {
    expect(control.number(3, { min: -10 })).toMatchObject({
      min: -10,
      max: 6,
    });
    expect(control.number(3, { max: 99 })).toMatchObject({ min: 0, max: 99 });
  });

  it("rejects a value outside an explicit range", () => {
    expect(() => control.number(5, { min: 0, max: 4 })).toThrow(/outside/);
  });

  it("rejects an inverted range", () => {
    expect(() => control.number(5, { min: 10, max: 2 })).toThrow(/greater/);
  });

  it("rejects a non-positive step and a non-finite value", () => {
    expect(() => control.number(1, { step: 0 })).toThrow(/step/);
    expect(() => control.number(Number.NaN)).toThrow(/finite/);
  });
});

describe("control.int", () => {
  it("pins step to 1", () => {
    expect(control.int(3, { min: 1, max: 12 })).toEqual({
      kind: "int",
      value: 3,
      min: 1,
      max: 12,
      step: 1,
      label: undefined,
    });
  });

  it("rejects a fractional value", () => {
    expect(() => control.int(2.5)).toThrow(/integer/);
  });
});

describe("control.select", () => {
  it("carries the options", () => {
    const def = control.select("green", ["green", "purple"]);
    expect(def).toEqual({
      kind: "select",
      value: "green",
      options: ["green", "purple"],
      label: undefined,
    });
  });

  it("rejects a value that is not an option, and an empty list", () => {
    expect(() => control.select("red", ["green", "purple"])).toThrow(
      /not one of/,
    );
    expect(() => control.select("red", [])).toThrow(/empty/);
  });
});

describe("controlDefaults", () => {
  it("reads the declared value of every control", () => {
    const controls = {
      count: control.int(3, { min: 1, max: 12 }),
      speed: control.number(40, { min: 5, max: 200 }),
      ledges: control.boolean(true),
      tint: control.select("green", ["green", "purple"]),
    } satisfies ControlSchema;

    expect(controlDefaults(controls)).toEqual({
      count: 3,
      speed: 40,
      ledges: true,
      tint: "green",
    });
  });

  it("returns an empty record for a scenario with no controls", () => {
    expect(controlDefaults(undefined)).toEqual({});
  });
});

describe("coerceControlValue", () => {
  it("clamps a number to the range", () => {
    const def = control.number(40, { min: 5, max: 200 });
    expect(coerceControlValue(def, 1000)).toBe(200);
    expect(coerceControlValue(def, -1)).toBe(5);
    expect(coerceControlValue(def, 60)).toBe(60);
  });

  it("rounds an int", () => {
    const def = control.int(3, { min: 1, max: 12 });
    expect(coerceControlValue(def, 4.7)).toBe(5);
  });

  it("throws on a value of the wrong kind rather than substituting a default", () => {
    expect(() =>
      coerceControlValue(control.number(40, { min: 5, max: 200 }), "nonsense"),
    ).toThrow(/finite number/);
    expect(() =>
      coerceControlValue(control.select("a", ["a", "b"]), "z"),
    ).toThrow(/one of a, b/);
    expect(() => coerceControlValue(control.boolean(true), 1)).toThrow(
      /boolean/,
    );
  });

  it("passes a boolean through", () => {
    expect(coerceControlValue(control.boolean(true), false)).toBe(false);
  });
});
