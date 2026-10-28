import { describe, expect, it, vi } from "vitest";
import { createMockEntity } from "@yagejs/core";
import { AudioManager, AudioManagerKey, registerSound } from "@yagejs/audio";
import { Feel } from "../Feel.js";
import { feelLoop, feelSequence } from "../core/node.js";
import { feelCall } from "../effects/core.js";
import { feelSound } from "./audio.js";

class TestParam {
  value = 1;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  cancelScheduledValues(): void {}
}
class TestNode {
  gain = new TestParam();
  pan = new TestParam();
  connect(): void {}
  disconnect(): void {}
}
class TestSource extends TestNode {
  playbackRate = new TestParam();
  onended: (() => void) | null = null;
  stopTime: number | undefined;
  start(): void {}
  stop(at = 0): void {
    this.stopTime = at;
  }
  end(): void {
    this.onended?.();
  }
}
function setupAudio() {
  const { entity, scene } = createMockEntity();
  const instances: TestSource[] = [];
  const context = {
    currentTime: 0,
    sampleRate: 44100,
    state: "running",
    destination: new TestNode(),
    createGain: () => new TestNode(),
    createStereoPanner: () => new TestNode(),
    createBufferSource: () => {
      const source = new TestSource();
      instances.push(source);
      return source;
    },
    // The manager follows the context's state changes; this one never changes.
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const manager = new AudioManager(context as unknown as BaseAudioContext);
  const buffer = {
    length: 88200,
    duration: 2,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(88200),
  } as unknown as AudioBuffer;
  registerSound("confirm", buffer);
  registerSound("reel", buffer);
  scene._registerScoped(AudioManagerKey, manager);
  const clock = {
    advance(dt: number): void {
      context.currentTime += dt;
      for (const source of instances)
        if (
          source.stopTime !== undefined &&
          source.stopTime <= context.currentTime
        )
          source.end();
    },
  };
  return { entity, manager, clock, instances };
}

describe("Feel audio ownership", () => {
  it.each([false, true])(
    "lets a sequence destroy its owner without cutting sound lifetime (once=%s)",
    (once) => {
      const { entity, instances, manager } = setupAudio();
      const onEnd = vi.fn();
      const feel = entity.add(
        new Feel({
          confirm: feelSequence(
            feelSound({ alias: "confirm", lifetime: "sound", once, onEnd }),
            feelCall(() => entity.destroy()),
          ),
        }),
      );
      const playback = feel.play("confirm")!;
      expect(entity.isDestroyed).toBe(true);
      expect(playback.active).toBe(false);
      expect(instances[0]!.stopTime).toBeUndefined();
      instances[0]!.end();
      expect(onEnd).toHaveBeenCalledOnce();
      manager.stopAll();
      expect(instances[0]!.stopTime).toBeUndefined();
    },
  );

  it.each([false, true])(
    "finishes loop release after audio fades, without advancing the cue clock (once=%s)",
    (once) => {
      const { entity, instances, clock, manager } = setupAudio();
      const feel = entity.add(
        new Feel({
          reel: feelLoop(feelSound({ alias: "reel", once, fadeOut: 0.2 }), 0.1),
        }),
      );
      const playback = feel.play("reel")!;
      feel.update(0.1);
      playback.release();
      expect(playback.active).toBe(true);
      clock.advance(0.1);
      expect(manager.getDiagnostics().activeVoices).toBe(instances.length);
      clock.advance(0.1);
      feel.update(0);
      expect(playback.active).toBe(false);
      expect(manager.getDiagnostics().activeVoices).toBe(0);
    },
  );

  it.each([false, true])(
    "finishes the fade after owner destruction (once=%s)",
    (once) => {
      const { entity, instances, clock, manager } = setupAudio();
      const feel = entity.add(
        new Feel({ reel: feelSound({ alias: "reel", once, fadeOut: 0.2 }) }),
      );
      const playback = feel.play("reel")!;
      entity.destroy();
      expect(playback.active).toBe(false);
      expect(instances[0]!.stopTime).toBe(0.2);
      expect(manager.getDiagnostics().activeVoices).toBe(1);
      clock.advance(0.2);
      expect(manager.getDiagnostics().activeVoices).toBe(0);
    },
  );

  it.each([false, true])(
    "suppresses cue-owned onEnd after release or cancellation (once=%s)",
    (once) => {
      for (const action of ["release", "destroy"] as const) {
        const { entity, instances } = setupAudio();
        const onEnd = vi.fn();
        const feel = entity.add(
          new Feel({
            reel: feelSound({ alias: "reel", once, fadeOut: 1, onEnd }),
          }),
        );
        const playback = feel.play("reel")!;
        if (action === "destroy") entity.destroy();
        else playback.release();
        instances[0]!.end();
        expect(onEnd).not.toHaveBeenCalled();
        feel.update(0);
        expect(playback.active).toBe(false);
      }
    },
  );

  it("retains shared sound lifetime when another cue releases with a fade", () => {
    const { entity, instances, clock, manager } = setupAudio();
    const feel = entity.add(
      new Feel({
        finish: feelSound({ alias: "confirm", once: true, lifetime: "sound" }),
        fade: feelSound({ alias: "confirm", once: true, fadeOut: 0.2 }),
      }),
    );
    feel.play("finish")!.stop();
    feel.play("fade")!.release();
    clock.advance(0.2);
    expect(instances).toHaveLength(1);
    expect(manager.getDiagnostics().activeVoices).toBe(1);
    expect(instances[0]!.stopTime).toBeUndefined();
  });
});
