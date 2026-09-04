import { describe, expect, it, vi } from "vitest";
import { createMockEntity } from "@yagejs/core";
import {
  AudioManagerKey,
  type AudioManager,
  type SoundHandle,
  type SoundRequestHandle,
} from "@yagejs/audio";
import { Feel } from "../Feel.js";
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

  it("keeps its cue active until the sound ends naturally", () => {
    const { entity, scene } = createMockEntity();
    const sound = createSoundHandle();
    const manager = {
      play: vi.fn(() => sound.handle),
    } as unknown as AudioManager;
    scene._registerScoped(AudioManagerKey, manager);
    const feel = entity.add(
      new Feel({ sound: feelSound({ alias: "impact" }) }),
    );

    const playback = feel.play("sound");
    expect(playback?.active).toBe(true);

    sound.end();
    feel.update(0);
    expect(playback?.active).toBe(false);
    expect(sound.stop).not.toHaveBeenCalled();
  });

  it("stops an owned sound on release or cancellation", () => {
    const { entity, scene } = createMockEntity();
    const first = createSoundHandle();
    const second = createSoundHandle();
    const manager = {
      play: vi
        .fn<() => SoundHandle>()
        .mockReturnValueOnce(first.handle)
        .mockReturnValueOnce(second.handle),
    } as unknown as AudioManager;
    scene._registerScoped(AudioManagerKey, manager);
    const feel = entity.add(
      new Feel({
        sound: { overlap: "allow", effect: feelSound({ alias: "impact" }) },
      }),
    );

    const released = feel.play("sound");
    released?.release();
    expect(first.stop).toHaveBeenCalledOnce();

    const cancelled = feel.play("sound");
    cancelled?.stop();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it("releases only the request owned by each once playback", () => {
    const { entity, scene } = createMockEntity();
    const firstRequest = createSoundRequest();
    const secondRequest = createSoundRequest();
    const manager = {
      requestOnce: vi
        .fn<() => SoundRequestHandle>()
        .mockReturnValueOnce(firstRequest.handle)
        .mockReturnValueOnce(secondRequest.handle),
    } as unknown as AudioManager;
    scene._registerScoped(AudioManagerKey, manager);
    const feel = entity.add(
      new Feel({
        sound: {
          overlap: "allow",
          effect: feelSound({ alias: "impact", once: true }),
        },
      }),
    );

    const first = feel.play("sound");
    const second = feel.play("sound");
    first?.release();
    expect(firstRequest.release).toHaveBeenCalledOnce();
    expect(secondRequest.release).not.toHaveBeenCalled();
    expect(first?.active).toBe(false);
    expect(second?.active).toBe(true);

    second?.release();
    expect(secondRequest.release).toHaveBeenCalledOnce();
    expect(second?.active).toBe(false);
  });
});

function createSoundHandle(): {
  handle: SoundHandle;
  stop: ReturnType<typeof vi.fn>;
  end(): void;
} {
  let playing = true;
  const stop = vi.fn(() => {
    playing = false;
  });
  const handle = {
    get playing() {
      return playing;
    },
    stop,
  } as unknown as SoundHandle;
  return {
    handle,
    stop,
    end: () => {
      playing = false;
    },
  };
}

function createSoundRequest(): {
  handle: SoundRequestHandle;
  release: ReturnType<typeof vi.fn>;
} {
  let active = true;
  const release = vi.fn(() => {
    active = false;
  });
  return {
    handle: {
      get active() {
        return active;
      },
      release,
    },
    release,
  };
}
