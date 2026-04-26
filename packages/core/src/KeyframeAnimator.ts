import { Component } from "./Component.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { createKeyframeTrack } from "./KeyframeTrack.js";
import type { Keyframe, KeyframeTrackOptions } from "./KeyframeTrack.js";
import type { Process } from "./Process.js";
import type { Interpolatable } from "./interpolate.js";
import type { EasingFunction } from "./types.js";
import { serializable } from "./Serializable.js";

/** Definition for a named keyframe animation. */
export interface KeyframeAnimationDef<T extends Interpolatable = Interpolatable> {
  keyframes: Keyframe<T>[];
  setter: (value: T) => void;
  loop?: boolean;
  speed?: number;
  duration?: number;
  easing?: EasingFunction;
  onEnter?: () => void;
  onExit?: (complete: boolean) => void;
}

/**
 * Component that manages named keyframe animations.
 *
 * Multiple animations can play concurrently (bob + pulse).
 * Each animation runs as a Process on the sibling ProcessComponent.
 * Requires a sibling ProcessComponent on the same entity.
 */
@serializable
export class KeyframeAnimator<T extends string = string> extends Component {
  private readonly defs: Record<string, KeyframeAnimationDef>;
  private readonly active = new Map<string, Process>();
  private readonly pc = this.sibling(ProcessComponent);

  constructor(animations: Record<T, KeyframeAnimationDef>) {
    super();
    this.defs = animations;
  }

  /** Start (or restart) a named animation. */
  play(name: T): void {
    const def = this.defs[name];
    if (!def) return;

    // Restart if already playing
    if (this.active.has(name)) {
      this.stopInternal(name, false);
    }

    def.onEnter?.();

    const opts: KeyframeTrackOptions<Interpolatable> = {
      keyframes: def.keyframes,
      setter: def.setter,
      onComplete: () => {
        this.active.delete(name);
        def.onExit?.(true);
      },
    };
    if (def.loop !== undefined) opts.loop = def.loop;
    if (def.speed !== undefined) opts.speed = def.speed;
    if (def.duration !== undefined) opts.duration = def.duration;
    if (def.easing !== undefined) opts.easing = def.easing;

    const process = createKeyframeTrack(opts);

    this.active.set(name, process);
    this.pc.run(process);
  }

  /** Stop a named animation. */
  stop(name: T): void {
    this.stopInternal(name, false);
  }

  /** Stop all playing animations. */
  stopAll(): void {
    for (const name of [...this.active.keys()]) {
      this.stopInternal(name, false);
    }
  }

  /** Whether a named animation is currently playing. */
  isPlaying(name: T): boolean {
    return this.active.has(name);
  }

  override onDestroy(): void {
    this.stopAll();
  }

  serialize(): null {
    return null;
  }

  private stopInternal(name: string, complete: boolean): void {
    const process = this.active.get(name);
    if (!process) return;
    process.cancel();
    this.active.delete(name);
    this.defs[name]?.onExit?.(complete);
  }
}
