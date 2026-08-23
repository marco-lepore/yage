import { describe, expect, it, vi } from "vitest";
import { feelSound, type FeelSoundOptions } from "./audio.js";

vi.mock("@yagejs/audio", () => ({ AudioManagerKey: {} }));

describe("feelSound", () => {
  it("rejects looping audio because a zero-duration cue cannot own its lifetime", () => {
    const options: FeelSoundOptions & { loop: boolean } = {
      alias: "ambience",
      loop: true,
    };

    expect(() => feelSound(options)).toThrow(/looping audio/);
  });

  it("accepts an explicit false loop value from shared audio options", () => {
    const options: FeelSoundOptions & { loop: boolean } = {
      alias: "impact",
      loop: false,
    };

    expect(() => feelSound(options)).not.toThrow();
  });
});
