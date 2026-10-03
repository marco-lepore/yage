import { describe, expect, it, vi } from "vitest";
import { createMockEntity, RandomKey, createRandomService } from "@yagejs/core";
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
  it.each(["release", "stop", "destroy", "disable"] as const)(
    "lets a sound finish after %s when its lifetime is sound",
    (action) => {
      const { entity, scene } = createMockEntity();
      const sound = createSoundHandle();
      const onEnd = vi.fn();
      const play = vi.fn(() => sound.handle);
      scene._registerScoped(AudioManagerKey, {
        play,
      } as unknown as AudioManager);
      const feel = entity.add(
        new Feel({
          confirm: feelSound({ alias: "confirm", lifetime: "sound", onEnd }),
        }),
      );
      const playback = feel.play("confirm")!;
      if (action === "destroy") entity.destroy();
      else if (action === "disable") feel.enabled = false;
      else playback[action]();
      expect(sound.stop).not.toHaveBeenCalled();
      if (action === "release") expect(playback.active).toBe(true);
      else expect(playback.active).toBe(false);
      sound.end();
      const options = (
        play.mock.calls[0] as unknown as [string, { onEnd(): void }]
      )[1];
      options.onEnd();
      feel.update(0);
      expect(onEnd).toHaveBeenCalledOnce();
      expect(playback.active).toBe(false);
    },
  );

  it("retains a shared request with sound lifetime after owner destruction", () => {
    const { entity, scene } = createMockEntity();
    const request = createSoundRequest();
    scene._registerScoped(AudioManagerKey, {
      requestOnce: () => request.handle,
    } as unknown as AudioManager);
    entity
      .add(
        new Feel({
          confirm: feelSound({
            alias: "confirm",
            once: true,
            lifetime: "sound",
          }),
        }),
      )
      .play("confirm");
    entity.destroy();
    expect(request.release).not.toHaveBeenCalled();
    expect(request.handle.active).toBe(true);
  });

  it("fades on release only once and waits for the tail", () => {
    const { entity, scene } = createMockEntity();
    const sound = createSoundHandle();
    const fadeTo = vi.fn();
    scene._registerScoped(AudioManagerKey, {
      play: () => Object.assign(sound.handle, { fadeTo }),
    } as unknown as AudioManager);
    const feel = entity.add(
      new Feel({ reel: feelSound({ alias: "reel", fadeOut: 0.02 }) }),
    );
    const playback = feel.play("reel")!;
    playback.release();
    expect(playback.active).toBe(true);
    playback.stop();
    expect(playback.active).toBe(false);
    expect(fadeTo).toHaveBeenCalledExactlyOnceWith(0, {
      duration: 0.02,
      stopOnComplete: true,
    });
    expect(sound.stop).not.toHaveBeenCalled();
  });

  it("passes the fade to shared request ownership", () => {
    const { entity, scene } = createMockEntity();
    const request = createSoundRequest();
    scene._registerScoped(AudioManagerKey, {
      requestOnce: () => request.handle,
    } as unknown as AudioManager);
    const feel = entity.add(
      new Feel({
        reel: feelSound({ alias: "reel", once: true, fadeOut: 0.02 }),
      }),
    );
    feel.play("reel")!.release();
    expect(request.release).toHaveBeenCalledWith({ fadeOut: 0.02 });
  });

  it("chooses aliases from the scene generator for every play", () => {
    const { entity, scene } = createMockEntity();
    const seed = 851;
    scene._registerScoped(RandomKey, createRandomService(seed));
    const expected = createRandomService(seed);
    const aliases = ["hurt-1", "hurt-2", "hurt-3"] as const;
    const requestOnce = vi.fn(() => createSoundRequest().handle);
    scene._registerScoped(AudioManagerKey, {
      requestOnce,
    } as unknown as AudioManager);
    const feel = entity.add(
      new Feel({ hurt: feelSound({ alias: aliases, once: true }) }),
    );
    for (let i = 0; i < 8; i++) {
      feel.play("hurt");
      expect(requestOnce).toHaveBeenLastCalledWith(
        expected.pick(aliases),
        expect.any(Object),
      );
    }
  });

  it("rejects an empty alias list", () => {
    expect(() => feelSound({ alias: [] })).toThrow(/alias/);
  });

  it.each([-1, NaN, Infinity])("rejects fadeOut %s", (fadeOut) => {
    expect(() => feelSound({ alias: "reel", fadeOut })).toThrow(/fadeOut/);
  });

  it("rejects a fade for a sound that must finish naturally", () => {
    expect(() =>
      feelSound({ alias: "confirm", lifetime: "sound", fadeOut: 0.02 }),
    ).toThrow(/lifetime/);
  });

  it("rejects looping audio because a zero-duration cue cannot own its lifetime", () => {
    const options: FeelSoundOptions & { loop: boolean } = {
      alias: "ambience",
      loop: true,
    };

    expect(() => feelSound(options)).toThrow(/feelLoop/);
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
