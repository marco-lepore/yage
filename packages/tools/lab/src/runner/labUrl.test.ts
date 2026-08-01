import { describe, expect, it } from "vitest";
import { control } from "../grammar/controls.js";
import { controlsFromUrl, readLabUrl, writeLabUrl } from "./labUrl.js";

const schema = {
  count: control.int(3, { min: 1, max: 12 }),
  bounce: control.number(0.6, { min: 0, max: 1, step: 0.05 }),
  ledges: control.boolean(true),
  tint: control.select("green", ["green", "purple"]),
};

describe("readLabUrl", () => {
  it("reads the scenario, the clock and prefixed control values", () => {
    expect(
      readLabUrl("?scenario=physics/drop&speed=0.25&paused=1&c.count=8"),
    ).toEqual({
      scenario: "physics/drop",
      controls: { count: "8" },
      speed: 0.25,
      paused: true,
    });
  });

  it("leaves out what the query string does not carry", () => {
    expect(readLabUrl("")).toEqual({
      scenario: undefined,
      controls: {},
      speed: undefined,
      paused: undefined,
    });
  });

  it("ignores a speed that is not a number", () => {
    expect(readLabUrl("?speed=fast").speed).toBeUndefined();
  });

  it("reads both spellings of the paused flag, because a URL is hand-edited", () => {
    expect(readLabUrl("?paused=0").paused).toBe(false);
    expect(readLabUrl("?paused=false").paused).toBe(false);
    expect(readLabUrl("?paused=true").paused).toBe(true);
    expect(readLabUrl("?paused=1").paused).toBe(true);
  });

  it("ignores a paused flag it cannot read", () => {
    expect(readLabUrl("?paused=maybe").paused).toBeUndefined();
  });
});

describe("writeLabUrl", () => {
  const values = { count: 3, bounce: 0.6, ledges: true, tint: "green" };

  it("writes only what differs from the declared values", () => {
    expect(
      writeLabUrl("", {
        scenario: "physics/drop",
        controls: { ...values, count: 8 },
        schema,
        speed: 1,
        paused: false,
      }),
    ).toBe("?scenario=physics%2Fdrop&c.count=8");
  });

  it("writes the clock only when it is off its default", () => {
    expect(
      writeLabUrl("", {
        scenario: "a",
        controls: values,
        schema,
        speed: 0.25,
        paused: true,
      }),
    ).toBe("?scenario=a&speed=0.25&paused=1");
  });

  it("keeps parameters the lab does not own and replaces the ones it does", () => {
    expect(
      writeLabUrl("?debug=1&scenario=old&c.count=9", {
        scenario: "new",
        controls: values,
        schema,
        speed: 1,
        paused: false,
      }),
    ).toBe("?debug=1&scenario=new");
  });

  it("round-trips a changed value of every control kind", () => {
    const changed = { count: 8, bounce: 0.25, ledges: false, tint: "purple" };
    const search = writeLabUrl("", {
      scenario: "a",
      controls: changed,
      schema,
      speed: 1,
      paused: false,
    });
    expect(controlsFromUrl(schema, readLabUrl(search).controls)).toEqual(
      changed,
    );
  });
});

describe("controlsFromUrl", () => {
  it("clamps a number and rounds an int", () => {
    expect(controlsFromUrl(schema, { count: "99.6", bounce: "-4" })).toEqual({
      count: 12,
      bounce: 0,
    });
  });

  it("drops a value the control cannot take", () => {
    expect(
      controlsFromUrl(schema, {
        count: "many",
        ledges: "yes",
        tint: "chartreuse",
        bounce: "",
      }),
    ).toEqual({});
  });

  it("drops a name the schema does not declare", () => {
    expect(controlsFromUrl(schema, { nonesuch: "1" })).toEqual({});
  });

  it("has nothing to read for a scenario with no controls", () => {
    expect(controlsFromUrl(undefined, { count: "8" })).toEqual({});
  });
});
