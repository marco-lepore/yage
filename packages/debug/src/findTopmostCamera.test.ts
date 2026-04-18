import { describe, it, expect, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0, set: vi.fn() };
    scale = { x: 1, y: 1, set: vi.fn() };
    rotation = 0;
    visible = true;
    addChild<T extends MockContainer>(child: T): T {
      this.children.push(child);
      return child;
    }
    removeFromParent(): void {}
    destroy(): void {}
  }
  return { mocks: { MockContainer } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: class extends mocks.MockContainer {
    clear() {
      return this;
    }
    rect() {
      return this;
    }
    circle() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
  },
}));

import { CameraComponent } from "@yagejs/renderer";
import type { Scene, SceneManager } from "@yagejs/core";
import { findTopmostCamera } from "./DebugPlugin.js";

function makeSceneWithCamera(cam?: CameraComponent): Scene {
  const entity = {
    tryGet: (C: unknown) =>
      C === CameraComponent ? (cam as unknown) : undefined,
  };
  return {
    getEntities: () => (cam ? [entity] : []),
  } as unknown as Scene;
}

function makeSceneManager(stack: Scene[]): SceneManager {
  return { all: stack } as unknown as SceneManager;
}

describe("findTopmostCamera", () => {
  it("returns the topmost scene's camera in a stack", () => {
    const bottomCam = new CameraComponent({ name: "bottom" });
    const topCam = new CameraComponent({ name: "top" });
    const bottom = makeSceneWithCamera(bottomCam);
    const top = makeSceneWithCamera(topCam);
    // `.all` is bottom→top, so top is last.
    const sm = makeSceneManager([bottom, top]);
    const found = findTopmostCamera(sm);
    expect(found?.cameraName).toBe("top");
  });

  it("falls back to a lower scene when the top has no camera", () => {
    const lowerCam = new CameraComponent({ name: "lower" });
    const lower = makeSceneWithCamera(lowerCam);
    const topNoCam = makeSceneWithCamera(undefined);
    const sm = makeSceneManager([lower, topNoCam]);
    const found = findTopmostCamera(sm);
    expect(found?.cameraName).toBe("lower");
  });

  it("returns undefined when no scene has a camera", () => {
    const sm = makeSceneManager([
      makeSceneWithCamera(undefined),
      makeSceneWithCamera(undefined),
    ]);
    expect(findTopmostCamera(sm)).toBeUndefined();
  });

  it("returns undefined on an empty stack", () => {
    const sm = makeSceneManager([]);
    expect(findTopmostCamera(sm)).toBeUndefined();
  });
});
