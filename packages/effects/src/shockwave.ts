import { Process } from "@yagejs/core";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { ShockwaveFilter } from "pixi-filters";
import type { Container, FilterSystem, RenderSurface, Texture } from "pixi.js";
import type { ShockwaveHandle } from "./handles.js";

/** Options for the {@link shockwave} preset. */
export interface ShockwaveOptions {
  /** Ripple speed in pixels/second of the input texture. Default: 500. */
  speed?: number;
  /** Ripple amplitude in pixels of the input texture. Default: 30. */
  amplitude?: number;
  /** Ripple wavelength in pixels of the input texture. Default: 160. */
  wavelength?: number;
  /** Ripple brightness multiplier. Default: 1. */
  brightness?: number;
  /** Maximum radius in pixels of the input texture (-1 for infinite). Default: -1. */
  radius?: number;
  /** Auto-trigger duration in ms — ramp `time` from 0 then idle. Default: 1000. */
  duration?: number;
}

/**
 * Subclass of pixi-filters `ShockwaveFilter` that interprets `center` in
 * the FILTER TARGET's container-local coordinate system rather than the
 * raw input-texture pixel space the upstream filter expects.
 *
 * Why: pixi-filters' shockwave puts `uOffset` directly into the shader,
 * which samples in input-texture pixels. The input texture's size is the
 * target container's world bounds in renderer pixels — i.e., post every
 * transform stacked above the filter target (camera zoom, the renderer
 * fit transform on `_worldRoot`, parent scaling). Passing
 * `entity.transform.position` (in virtual pixels) drifts off-target the
 * moment any of those transforms isn't identity — most commonly when
 * `fit` scales the canvas down on a narrow viewport.
 *
 * Fix: store the caller's local-space center, and re-derive the input-px
 * offset every frame inside `apply()` using the live `worldTransform` and
 * `input.frame` Pixi has already computed for this draw. Rotation,
 * non-uniform scale, and per-frame transform changes all flow through
 * automatically — no caller-side math, no engine-context plumbing.
 *
 * @internal
 */
class YageShockwaveFilter extends ShockwaveFilter {
  centerLocal: { x: number; y: number } = { x: 0, y: 0 };
  /** Filter target captured by the host effect on attach. */
  yageTarget: Container | undefined;

  override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    const target = this.yageTarget;
    if (target) {
      const wt = target.worldTransform;
      // Local point → world point via the cumulative transform Pixi has
      // already computed this frame.
      const worldX =
        wt.a * this.centerLocal.x + wt.c * this.centerLocal.y + wt.tx;
      const worldY =
        wt.b * this.centerLocal.x + wt.d * this.centerLocal.y + wt.ty;
      // World point → input-frame coords. `input.frame` is the rasterized
      // region in renderer-pixel space; subtracting its origin gives the
      // texture-relative offset the shader's `uOffset` actually needs.
      const frame = (input as unknown as { frame: { x: number; y: number } })
        .frame;
      this.center = {
        x: worldX - frame.x,
        y: worldY - frame.y,
      };
    }
    super.apply(filterManager, input, output, clearMode);
  }
}

// `time` value that's "obviously past the screen" — at the default speed of
// 500 px/s this is the radius reached after ~2 hours of simulation. Used as
// the parked state so toggling the effect on without a trigger yields no
// visible distortion.
const PARKED_TIME = 1e6;

/**
 * Concentric-ring ripple via pixi-filters' ShockwaveFilter — the impact
 * polish for explosions, slams, blast waves.
 *
 * Best applied at scene scope: the ring expands outward from `center` and
 * is naturally clipped at the host's bounds, so a component-scoped
 * shockwave on a small sprite reads as a tiny "bump" rather than a ring.
 *
 * `trigger(x, y)` accepts coordinates in the **filter target's local
 * coordinate system** — virtual pixels for scene/layer-scope effects,
 * sprite-local for component-scope. The wrapper converts to the
 * input-texture pixel space the shader actually samples in, every frame,
 * using the target container's live `worldTransform` and the rasterized
 * input frame. Resize the canvas, zoom the camera, attach the filter at
 * a different scope — the trigger keeps lining up with whatever you fed
 * it. (Other dimensions — `radius`, `wavelength`, `speed` — stay in
 * input-texture pixels because they're rarely runtime-tweaked; convert
 * by the same canvas/virtual ratio if needed.)
 *
 * The filter starts in a "parked" state (time pushed past every visible
 * pixel) so toggling on is invisible until you `trigger()`. The trigger
 * ramp drives itself through the engine's process scheduler — pauses with
 * the owning scene, time-scales with it, auto-cancels on `remove()`.
 *
 * `setIntensity` cross-fades amplitude × brightness from 0 to the configured
 * values so `fadeIn`/`fadeOut` work the same as on every other preset.
 */
export const shockwave = defineEffect<ShockwaveHandle, ShockwaveOptions>({
  name: "yage:shockwave",
  factory: (options) => {
    const baseAmplitude = options.amplitude ?? 30;
    const baseBrightness = options.brightness ?? 1;
    const duration = options.duration ?? 1000;
    const filter = new YageShockwaveFilter({
      speed: options.speed ?? 500,
      amplitude: baseAmplitude,
      wavelength: options.wavelength ?? 160,
      brightness: baseBrightness,
      radius: options.radius ?? -1,
      // Park the initial ring offscreen so toggling the effect on (without
      // a trigger) shows nothing. Without this, time=0 places the ring
      // exactly at `center`, producing a stationary "bump" pinned there.
      time: PARKED_TIME,
    });
    let intensity = 1;
    const apply = (): void => {
      filter.amplitude = baseAmplitude * intensity;
      filter.brightness = baseBrightness * intensity;
    };
    apply();
    const effect: Effect<ShockwaveHandle> = {
      filter,
      getIntensity: () => intensity,
      setIntensity: (v) => {
        intensity = v;
        apply();
      },
      onAttach: (target) => {
        // Capture the filter target so `apply()` can read its
        // `worldTransform` each frame. Without this, `centerLocal` has
        // nothing to project against and falls back to identity (= raw
        // pixel coords, the upstream pixi-filters behavior).
        filter.yageTarget = target.displayObject;
      },
      onDetach: () => {
        filter.yageTarget = undefined;
      },
      buildExtras: (base) => {
        let inFlight: Process | undefined;
        return {
          trigger: (x = 0, y = 0) => {
            // Cancel any in-flight ramp before starting a new one — overlapping
            // shockwaves on the same filter would otherwise stomp `time`
            // mid-frame and produce a visible glitch.
            inFlight?.cancel();
            filter.centerLocal = { x, y };
            filter.time = 0;
            inFlight = base.run(
              new Process({
                duration,
                update: (dt) => {
                  filter.time += dt / 1000;
                },
                onComplete: () => {
                  filter.time = PARKED_TIME;
                },
              }),
            );
          },
        };
      },
    };
    return effect;
  },
});
