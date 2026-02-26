import { describe, it, expect, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Particle: vi.fn(),
  ParticleContainer: vi.fn(),
  Container: vi.fn(),
}));

import { ParticlesPlugin } from "./ParticlesPlugin.js";
import { ParticleSystem } from "./ParticleSystem.js";

describe("ParticlesPlugin", () => {
  it("has name 'particles'", () => {
    const plugin = new ParticlesPlugin();
    expect(plugin.name).toBe("particles");
  });

  it("depends on renderer", () => {
    const plugin = new ParticlesPlugin();
    expect(plugin.dependencies).toContain("renderer");
  });

  it("registers ParticleSystem", () => {
    const plugin = new ParticlesPlugin();
    const scheduler = { add: vi.fn() };
    plugin.registerSystems(scheduler as never);
    expect(scheduler.add).toHaveBeenCalledTimes(1);
    expect(scheduler.add.mock.calls[0]![0]).toBeInstanceOf(ParticleSystem);
  });
});
