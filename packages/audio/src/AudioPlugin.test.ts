import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSound = vi.hoisted(() => ({
  play: vi.fn(),
  stop: vi.fn(),
  muteAll: vi.fn(),
  unmuteAll: vi.fn(),
  close: vi.fn(),
  exists: vi.fn(() => true),
}));

vi.mock("@pixi/sound", () => ({
  sound: mockSound,
}));

import { EngineContext } from "@yage/core";
import { AudioPlugin } from "./AudioPlugin.js";
import { AudioManagerKey } from "./types.js";
import { AudioManager } from "./AudioManager.js";

describe("AudioPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has name 'audio'", () => {
    const plugin = new AudioPlugin();
    expect(plugin.name).toBe("audio");
  });

  it("has no dependencies", () => {
    const plugin = new AudioPlugin();
    expect((plugin as unknown as Record<string, unknown>).dependencies).toBeUndefined();
  });

  it("install() registers AudioManager on context", () => {
    const plugin = new AudioPlugin();
    const context = new EngineContext();
    plugin.install(context);

    const manager = context.resolve(AudioManagerKey);
    expect(manager).toBeInstanceOf(AudioManager);
  });

  it("onDestroy() calls sound.close()", () => {
    const plugin = new AudioPlugin();
    plugin.onDestroy();
    expect(mockSound.close).toHaveBeenCalled();
  });
});
