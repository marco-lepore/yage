import { describe, it, expect } from "vitest";
import { ParticlePresets } from "./presets.js";

const tex = { label: "preset-tex" } as never;

describe("ParticlePresets", () => {
  for (const [name, factory] of Object.entries(ParticlePresets)) {
    describe(name, () => {
      it("returns a config with the given texture", () => {
        const config = factory(tex);
        expect(config.texture).toBe(tex);
      });

      it("has a positive maxParticles", () => {
        const config = factory(tex);
        expect(config.maxParticles).toBeGreaterThan(0);
      });

      it("has a positive rate", () => {
        const config = factory(tex);
        expect(config.rate).toBeGreaterThan(0);
      });

      it("has a defined lifetime", () => {
        const config = factory(tex);
        expect(config.lifetime).toBeDefined();
      });
    });
  }
});
