import { describe, it, expect, vi, beforeEach } from "vitest";
import { InputDebugContributor } from "./InputDebugContributor.js";
import { InputManager } from "./InputManager.js";
import type { WorldDebugApi, HudDebugApi, DebugGraphics } from "@yage/debug/api";

function createMockManager(): InputManager {
  const manager = new InputManager();
  manager.setActionMap({ jump: ["Space"], fire: ["MouseLeft"] });
  return manager;
}

function createMockGraphics(): DebugGraphics {
  const g: DebugGraphics = {
    position: { x: 0, y: 0 },
    rotation: 0,
    visible: true,
    clear: vi.fn(() => g),
    rect: vi.fn(() => g),
    circle: vi.fn(() => g),
    moveTo: vi.fn(() => g),
    lineTo: vi.fn(() => g),
    stroke: vi.fn(() => g),
    fill: vi.fn(() => g),
  };
  return g;
}

function createWorldApi(
  overrides?: Partial<WorldDebugApi>,
): WorldDebugApi {
  return {
    acquireGraphics: vi.fn(() => createMockGraphics()),
    isFlagEnabled: vi.fn(() => true),
    cameraZoom: 1,
    ...overrides,
  };
}

function createHudApi(overrides?: Partial<HudDebugApi>): HudDebugApi {
  return {
    addLine: vi.fn(),
    isFlagEnabled: vi.fn(() => true),
    screenWidth: 800,
    screenHeight: 600,
    ...overrides,
  };
}

describe("InputDebugContributor", () => {
  let manager: InputManager;
  let contributor: InputDebugContributor;

  beforeEach(() => {
    manager = createMockManager();
    contributor = new InputDebugContributor(manager);
  });

  it("has name and flags", () => {
    expect(contributor.name).toBe("input");
    expect(contributor.flags).toEqual(["actions", "pointer"]);
  });

  // -- drawWorld --

  it("drawWorld draws crosshair when pointer flag is enabled", () => {
    manager._onPointerMove(100, 50);
    const g = createMockGraphics();
    const api = createWorldApi({
      acquireGraphics: vi.fn(() => g),
    });

    contributor.drawWorld(api);

    expect(g.moveTo).toHaveBeenCalled();
    expect(g.lineTo).toHaveBeenCalled();
    expect(g.stroke).toHaveBeenCalledWith(
      expect.objectContaining({ color: 0xff00ff }),
    );
  });

  it("drawWorld skips when pointer flag is disabled", () => {
    const api = createWorldApi({
      isFlagEnabled: vi.fn(() => false),
    });

    contributor.drawWorld(api);

    expect(api.acquireGraphics).not.toHaveBeenCalled();
  });

  it("drawWorld skips when acquireGraphics returns undefined", () => {
    const api = createWorldApi({
      acquireGraphics: vi.fn(() => undefined),
    });

    expect(() => contributor.drawWorld(api)).not.toThrow();
  });

  it("drawWorld scales crosshair by camera zoom", () => {
    manager._onPointerMove(0, 0);
    const g = createMockGraphics();
    const api = createWorldApi({
      acquireGraphics: vi.fn(() => g),
      cameraZoom: 2,
    });

    contributor.drawWorld(api);

    // Crosshair size = 10 / 2 = 5, lineWidth = 1 / 2 = 0.5
    expect(g.stroke).toHaveBeenCalledWith(
      expect.objectContaining({ width: 0.5 }),
    );
  });

  // -- drawHud --

  it("drawHud shows pressed actions", () => {
    manager._onKeyDown("Space");
    const api = createHudApi();

    contributor.drawHud(api);

    expect(api.addLine).toHaveBeenCalledWith("Input: jump");
  });

  it("drawHud shows (none) when nothing pressed", () => {
    const api = createHudApi();

    contributor.drawHud(api);

    expect(api.addLine).toHaveBeenCalledWith("Input: (none)");
  });

  it("drawHud skips when actions flag is disabled", () => {
    const api = createHudApi({
      isFlagEnabled: vi.fn(() => false),
    });

    contributor.drawHud(api);

    expect(api.addLine).not.toHaveBeenCalled();
  });

  it("drawHud shows disabled groups when groups are configured", () => {
    manager.setGroups({ movement: ["jump"], combat: ["fire"] });
    manager.disableGroup("combat");
    const api = createHudApi();

    contributor.drawHud(api);

    expect(api.addLine).toHaveBeenCalledWith("Disabled groups: combat");
  });

  it("drawHud does not show group line when no groups disabled", () => {
    manager.setGroups({ movement: ["jump"] });
    const api = createHudApi();

    contributor.drawHud(api);

    expect(api.addLine).toHaveBeenCalledTimes(1);
    expect(api.addLine).toHaveBeenCalledWith("Input: (none)");
  });

  it("drawHud does not show group line when no groups configured", () => {
    const api = createHudApi();

    contributor.drawHud(api);

    expect(api.addLine).toHaveBeenCalledTimes(1);
  });
});
