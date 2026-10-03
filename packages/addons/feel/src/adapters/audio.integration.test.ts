import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createMockEntity, Process } from "@yagejs/core";
import type { ScopedProcessQueue } from "@yagejs/core";
import { AudioManager, AudioManagerKey } from "@yagejs/audio";
import { Feel } from "../Feel.js";
import { feelLoop, feelSequence } from "../core/node.js";
import { feelCall } from "../effects/core.js";
import { feelSound } from "./audio.js";

class TestAudioClock implements ScopedProcessQueue {
  private readonly processes = new Set<Process>();

  run(process: Process): Process {
    this.processes.add(process);
    return process;
  }

  cancelAll(): void {
    for (const process of this.processes) process.cancel();
    this.processes.clear();
  }

  advance(dt: number): void {
    for (const process of this.processes) {
      process._update(dt);
      if (process.completed) this.processes.delete(process);
    }
  }
}

function setupAudio() {
  const { entity, scene } = createMockEntity();
  const clock = new TestAudioClock();
  const instances: ReturnType<typeof createInstance>[] = [];
  const library = {
    exists: () => true,
    play: () => {
      const instance = createInstance();
      instances.push(instance);
      return instance;
    },
  } as unknown as ConstructorParameters<typeof AudioManager>[0];
  const manager = new AudioManager(library, undefined, undefined, clock);
  scene._registerScoped(AudioManagerKey, manager);
  return { entity, manager, clock, instances };
}

function createInstance() {
  const events = new EventEmitter();
  return Object.assign(events, {
    volume: 1,
    stop: vi.fn(() => events.emit("stop")),
  });
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
      expect(instances[0]!.stop).not.toHaveBeenCalled();
      instances[0]!.emit("end");
      expect(onEnd).toHaveBeenCalledOnce();
      manager.stopAll();
      expect(instances[0]!.stop).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "finishes loop release after audio fades, without advancing the cue clock (once=%s)",
    (once) => {
      const { entity, instances, clock } = setupAudio();
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
      for (const instance of instances)
        expect(instance.volume).toBeCloseTo(0.5);
      clock.advance(0.1);
      feel.update(0);
      expect(playback.active).toBe(false);
      for (const instance of instances)
        expect(instance.stop).toHaveBeenCalledOnce();
    },
  );

  it.each([false, true])(
    "finishes the fade after owner destruction (once=%s)",
    (once) => {
      const { entity, instances, clock } = setupAudio();
      const feel = entity.add(
        new Feel({ reel: feelSound({ alias: "reel", once, fadeOut: 0.2 }) }),
      );
      const playback = feel.play("reel")!;
      entity.destroy();
      expect(playback.active).toBe(false);
      expect(instances[0]!.stop).not.toHaveBeenCalled();
      clock.advance(0.2);
      expect(instances[0]!.stop).toHaveBeenCalledOnce();
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
        instances[0]!.emit("end");
        expect(onEnd).not.toHaveBeenCalled();
        feel.update(0);
        expect(playback.active).toBe(false);
      }
    },
  );

  it("retains shared sound lifetime when another cue releases with a fade", () => {
    const { entity, instances, clock } = setupAudio();
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
    expect(instances[0]!.volume).toBe(1);
    expect(instances[0]!.stop).not.toHaveBeenCalled();
  });
});
