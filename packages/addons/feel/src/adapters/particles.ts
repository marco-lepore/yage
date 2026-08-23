import type { Vec2Like } from "@yagejs/core";
import { ParticleEmitterComponent } from "@yagejs/particles";
import { defineFeelEffect } from "../core/node.js";
import type { FeelEffectContext, FeelNode } from "../core/types.js";

type FeelEmitterTarget =
  | ParticleEmitterComponent
  | ((context: FeelEffectContext) => ParticleEmitterComponent);

export interface FeelParticleBurstOptions {
  emitter: FeelEmitterTarget;
  /** Fixed or randomized particle count. */
  count: number | readonly [min: number, max: number];
  /** Optional explicit world position. Default: the emitter entity. */
  position?: Vec2Like | ((context: FeelEffectContext) => Vec2Like);
}

/** Burst particles from an existing emitter. */
export function feelParticleBurst(options: FeelParticleBurstOptions): FeelNode {
  return defineFeelEffect(0, (context) => ({
    start: () => {
      const emitter = resolveEmitter(options.emitter, context);
      const baseCount =
        typeof options.count === "number"
          ? options.count
          : context.random.int(options.count[0], options.count[1]);
      const count = Math.max(0, Math.round(baseCount * context.intensity));
      const position =
        typeof options.position === "function"
          ? options.position(context)
          : options.position;
      if (position) emitter.burst(count, position.x, position.y);
      else emitter.burst(count);
    },
  }));
}

export interface FeelParticleEmitOptions {
  emitter: FeelEmitterTarget;
  /** Emission window in seconds. Default: 0.25. */
  duration?: number;
}

interface EmitterUseState {
  users: number;
  wasEmitting: boolean;
}

const emitterUsers = new WeakMap<ParticleEmitterComponent, EmitterUseState>();

/** Enable an existing emitter for a timed window. Overlapping windows share it. */
export function feelParticleEmit(options: FeelParticleEmitOptions): FeelNode {
  return defineFeelEffect(options.duration ?? 0.25, (context) => {
    const emitter = resolveEmitter(options.emitter, context);
    let active = false;
    return {
      start: () => {
        active = true;
        const state = emitterUsers.get(emitter);
        if (state) {
          state.users++;
        } else {
          const wasEmitting = emitter.isEmitting;
          emitterUsers.set(emitter, { users: 1, wasEmitting });
          if (!wasEmitting) emitter.emit();
        }
      },
      finish: () => {
        if (!active) return;
        active = false;
        const state = emitterUsers.get(emitter);
        if (!state) return;
        state.users--;
        if (state.users <= 0) {
          emitterUsers.delete(emitter);
          if (!state.wasEmitting) emitter.stop();
        }
      },
    };
  });
}

function resolveEmitter(
  emitter: FeelEmitterTarget,
  context: FeelEffectContext,
): ParticleEmitterComponent {
  return typeof emitter === "function" ? emitter(context) : emitter;
}
