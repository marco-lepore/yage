import { describe, it, expect } from "vitest";
import { resolveTransition } from "./SceneTransition.js";
import type { SceneTransition } from "./SceneTransition.js";
import { Scene } from "./Scene.js";

class BareScene extends Scene {
  readonly name = "bare";
}

class DefaultTransitionScene extends Scene {
  readonly name = "default-transition";
  override readonly defaultTransition: SceneTransition = {
    duration: 500,
    tick() {},
  };
}

describe("resolveTransition", () => {
  it("returns call-site transition when provided", () => {
    const callSite: SceneTransition = { duration: 100, tick() {} };
    const scene = new DefaultTransitionScene();
    expect(resolveTransition(callSite, scene)).toBe(callSite);
  });

  it("falls back to destination defaultTransition", () => {
    const scene = new DefaultTransitionScene();
    expect(resolveTransition(undefined, scene)).toBe(scene.defaultTransition);
  });

  it("returns undefined when neither is set", () => {
    const scene = new BareScene();
    expect(resolveTransition(undefined, scene)).toBeUndefined();
  });

  it("returns undefined when destination is undefined", () => {
    expect(resolveTransition(undefined, undefined)).toBeUndefined();
  });

  it("prefers call-site over defaultTransition", () => {
    const callSite: SceneTransition = { duration: 100, tick() {} };
    const scene = new DefaultTransitionScene();
    const result = resolveTransition(callSite, scene);
    expect(result).toBe(callSite);
    expect(result).not.toBe(scene.defaultTransition);
  });
});
