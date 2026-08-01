import { describe, expect, it } from "vitest";
import type { Scene } from "@yagejs/core";
import { defineScenario, describeScenarioProblem } from "./scenario.js";
import { control } from "./controls.js";

const noopSetup = (): void => {};

describe("defineScenario", () => {
  it("returns the definition unchanged", () => {
    const def = defineScenario({ title: "Basics / Spin", setup: noopSetup });
    expect(def.title).toBe("Basics / Spin");
    expect(def.setup).toBe(noopSetup);
  });

  it("types control values from the schema", () => {
    defineScenario({
      title: "Enemies / Slime",
      controls: {
        count: control.int(3),
        tint: control.select("green", ["green", "purple"]),
        ledges: control.boolean(true),
      },
      setup(_scene, c) {
        const count: number = c.count;
        const tint: "green" | "purple" = c.tint;
        const ledges: boolean = c.ledges;
        expect([count, tint, ledges]).toEqual([3, "green", true]);
      },
    }).setup?.(undefined as unknown as Scene, {
      count: 3,
      tint: "green",
      ledges: true,
    });
  });

  it("rejects a definition with neither scene nor setup", () => {
    expect(() =>
      defineScenario({ title: "Broken" } as never),
    ).toThrow(/either `scene` or `setup`/);
  });

  it("rejects a definition with both", () => {
    expect(() =>
      defineScenario({
        title: "Broken",
        setup: noopSetup,
        scene: () => undefined as unknown as Scene,
      } as never),
    ).toThrow(/not both/);
  });

  it("rejects a blank title", () => {
    expect(() =>
      defineScenario({ title: "   ", setup: noopSetup }),
    ).toThrow(/title/);
  });
});

describe("describeScenarioProblem", () => {
  it("accepts a well-formed definition", () => {
    expect(
      describeScenarioProblem({ title: "Ok", setup: noopSetup }),
    ).toBeUndefined();
  });

  it("rejects a non-object", () => {
    expect(describeScenarioProblem(null)).toMatch(/object/);
    expect(describeScenarioProblem("nope")).toMatch(/object/);
  });
});
