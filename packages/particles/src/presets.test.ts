import { describe, it, expect } from "vitest";
import { ParticlePresets } from "./presets.js";
import { shapeTexture } from "./shapes.js";
import type { EmitterConfig } from "./types.js";

const tex = { label: "preset-tex" } as never;

/** The four checks every preset config has to pass, whatever its source. */
function expectUsableConfig(config: EmitterConfig): void {
  expect(config.maxParticles).toBeGreaterThan(0);
  expect(config.rate).toBeGreaterThan(0);
  expect(config.lifetime).toBeDefined();
  expect(config.scale).toBeDefined();
}

describe("ParticlePresets", () => {
  for (const [name, factory] of Object.entries(ParticlePresets)) {
    describe(name, () => {
      it("uses a texture argument as the source", () => {
        const config = factory(tex);
        expect(config.texture).toBe(tex);
        expect(config.shape).toBeUndefined();
        expectUsableConfig(config);
      });

      it("uses a string argument as an asset key", () => {
        const config = factory("assets/particle.png");
        expect(config.texture).toBe("assets/particle.png");
        expect(config.shape).toBeUndefined();
        expectUsableConfig(config);
      });

      it("falls back to a built-in shape with no argument", () => {
        const config = factory();
        expect(config.texture).toBeUndefined();
        expect(config.shape).toBeDefined();
        expectUsableConfig(config);
      });

      it("has a default shape that renders something", () => {
        // A shape sized down to nothing visible would leave the zero-asset
        // preset drawing an empty texture, which no other assertion catches.
        const texture = shapeTexture(factory().shape!);
        const data = texture.source.resource as Uint8Array;
        const alphas = data.filter((_, i) => i % 4 === 3);
        expect(Math.max(...alphas)).toBeGreaterThan(250);
      });
    });
  }
});
