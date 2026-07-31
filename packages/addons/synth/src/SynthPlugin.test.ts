import { beforeEach, describe, expect, it, vi } from "vitest";
import { synthPresets } from "./core/presets.js";
import { SYNTH_SAMPLE_RATE } from "./core/render.js";
import { SynthPlugin } from "./SynthPlugin.js";

// The real `registerSound` reaches @pixi/sound's singleton, which needs a
// browser (it type-checks `instanceof AudioBuffer` and builds an
// AudioContext). Stand in for it and assert what the plugin hands over.
const audio = vi.hoisted(() => ({
  registered: new Map<string, AudioBuffer>(),
  registerSound: vi.fn(),
  unregisterSound: vi.fn(),
}));

vi.mock("@yagejs/audio", () => ({
  registerSound: audio.registerSound,
  unregisterSound: audio.unregisterSound,
}));

/** Enough of an AudioBuffer for `synthBuffer` to fill and for tests to read. */
class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly _channel: Float32Array;

  constructor(options: {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
  }) {
    this.numberOfChannels = options.numberOfChannels;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this._channel = new Float32Array(options.length);
  }

  getChannelData(): Float32Array {
    return this._channel;
  }
}

beforeEach(() => {
  vi.stubGlobal("AudioBuffer", FakeAudioBuffer);
  audio.registered.clear();
  audio.registerSound.mockReset();
  audio.unregisterSound.mockReset();
  audio.registerSound.mockImplementation((alias: string, buffer: AudioBuffer) => {
    audio.registered.set(alias, buffer);
  });
  audio.unregisterSound.mockImplementation((alias: string) => {
    audio.registered.delete(alias);
  });
});

describe("SynthPlugin", () => {
  it("depends on the audio plugin", () => {
    expect(new SynthPlugin({ sounds: {} }).dependencies).toEqual(["audio"]);
  });

  it("registers one mono buffer per configured sound", () => {
    const plugin = new SynthPlugin({
      sounds: {
        blip: { frequency: 500, duration: 0.1 },
        boom: synthPresets.explosion(),
      },
    });
    plugin.install();

    expect([...audio.registered.keys()]).toEqual(["blip", "boom"]);
    const blip = audio.registered.get("blip");
    expect(blip?.numberOfChannels).toBe(1);
    expect(blip?.sampleRate).toBe(SYNTH_SAMPLE_RATE);
    expect(blip?.length).toBe(0.1 * SYNTH_SAMPLE_RATE);
    // Rendered, not blank.
    expect(Math.max(...(blip?.getChannelData(0) ?? []))).toBeGreaterThan(0);
  });

  it("renders at the configured sample rate", () => {
    const plugin = new SynthPlugin({
      sounds: { blip: { frequency: 500, duration: 0.1 } },
      sampleRate: 22050,
    });
    plugin.install();

    const blip = audio.registered.get("blip");
    expect(blip?.sampleRate).toBe(22050);
    expect(blip?.length).toBe(2205);
  });

  it("registers a variants entry as alias.1 … alias.n, each one different", () => {
    const plugin = new SynthPlugin({
      sounds: { shoot: { sound: synthPresets.shoot(), variants: 3 } },
    });
    plugin.install();

    expect([...audio.registered.keys()]).toEqual([
      "shoot.1",
      "shoot.2",
      "shoot.3",
    ]);
    expect(audio.registered.get("shoot.1")?.getChannelData(0)).not.toEqual(
      audio.registered.get("shoot.3")?.getChannelData(0),
    );
  });

  it("rejects a config whose entries collide on an alias, registering nothing", () => {
    const plugin = new SynthPlugin({
      sounds: {
        shoot: { sound: synthPresets.shoot(), variants: 2 },
        "shoot.1": synthPresets.uiClick(),
      },
    });
    expect(() => plugin.install()).toThrowError(/shoot\.1/);
    expect(audio.registerSound).not.toHaveBeenCalled();
    expect(plugin.aliases).toEqual([]);
  });

  it("rolls back what it registered when a later registration throws", () => {
    audio.registerSound.mockImplementationOnce(
      (alias: string, buffer: AudioBuffer) => {
        audio.registered.set(alias, buffer);
      },
    );
    audio.registerSound.mockImplementationOnce(() => {
      throw new Error("alias already used by a loaded sound");
    });
    const plugin = new SynthPlugin({
      sounds: { a: synthPresets.uiClick(), b: synthPresets.uiBlip() },
    });
    expect(() => plugin.install()).toThrowError(/loaded sound/);
    expect(plugin.aliases).toEqual([]);
    expect(audio.unregisterSound).toHaveBeenCalledWith("a");
  });

  it("refuses a second install while its aliases are registered", () => {
    const plugin = new SynthPlugin({ sounds: { a: synthPresets.uiClick() } });
    plugin.install();
    expect(() => plugin.install()).toThrowError(/install/);
    plugin.onDestroy();
    expect(() => plugin.install()).not.toThrow();
  });

  it("lists what it registered and gives it all back on destroy", () => {
    const plugin = new SynthPlugin({
      sounds: {
        click: synthPresets.uiClick(),
        step: { sound: synthPresets.footstep(), variants: 2 },
      },
    });
    plugin.install();
    expect(plugin.aliases).toEqual(["click", "step.1", "step.2"]);

    plugin.onDestroy();
    expect(audio.unregisterSound.mock.calls.map(([alias]) => alias)).toEqual([
      "click",
      "step.1",
      "step.2",
    ]);
    expect(audio.registered.size).toBe(0);
    expect(plugin.aliases).toEqual([]);
  });
});
