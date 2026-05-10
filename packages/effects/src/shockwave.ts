import { Process } from "@yagejs/core";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { ShockwaveFilter } from "pixi-filters";
import type { Container, FilterSystem, RenderSurface, Texture } from "pixi.js";
import type { ShockwaveHandle } from "./handles.js";

/** Options for the {@link shockwave} preset. */
export interface ShockwaveOptions {
  /** Ripple speed in pixels/second of the filter target's local space. Default: 500. */
  speed?: number;
  /** Ripple amplitude in pixels of the filter target's local space. Default: 30. */
  amplitude?: number;
  /** Ripple wavelength in pixels of the filter target's local space. Default: 160. */
  wavelength?: number;
  /** Ripple brightness multiplier. Unitless. Default: 1. */
  brightness?: number;
  /**
   * Maximum radius in pixels of the filter target's local space.
   * `-1` (default) keeps the ring expanding forever (no max-radius fade).
   */
  radius?: number;
  /** Auto-trigger duration in ms — ramp `time` from 0 then idle. Default: 1000. */
  duration?: number;
}

/**
 * Subclass of pixi-filters `ShockwaveFilter` that interprets every
 * pixel-valued input — `center`, `amplitude`, `wavelength`, `radius`,
 * `speed` — in the FILTER TARGET's container-local coordinate system
 * rather than the raw input-texture pixel space the upstream filter
 * expects.
 *
 * Why: the upstream shader normalizes each of these by `uInputSize`
 * (renderer pixels post every transform stacked above the filter target).
 * Passing virtual-px values directly works at the default 1.0 fit ratio
 * but visibly drifts the ring's center, AND its size, AND its travel
 * speed the moment the canvas is scaled (narrow viewport, mobile,
 * camera zoom). We don't just want the trigger point to land on the
 * hero — we want a 30-virtual-px-amplitude ring at native to look like
 * a 30-virtual-px-amplitude ring after `fit` halves the canvas.
 *
 * Fix: store every dimensional input in caller-local units, and re-scale
 * each frame inside `apply()` using the live `worldTransform` Pixi has
 * already computed for this draw. Rotation, non-uniform scale, and
 * per-frame transform changes all flow through automatically — no
 * caller-side math, no engine-context plumbing. (See pixi-filters'
 * BulgePinchFilter for the same trick at a smaller scale: its `apply()`
 * reads `input.frame.width/height` so its `center` stays normalized 0..1.)
 *
 * Non-uniform scale: size-related uniforms (amplitude / wavelength /
 * radius) use the mean of x/y axis magnitudes so the ring stays
 * symmetric in user units. Speed uses x-axis magnitude only because the
 * shader's normalization uses `uInputSize.x`. Both choices are wrong
 * under arbitrary rotation, but right under the fit + camera-zoom cases
 * users actually hit.
 *
 * @internal
 */
class YageShockwaveFilter extends ShockwaveFilter {
  centerLocal: { x: number; y: number } = { x: 0, y: 0 };
  baseAmplitudeLocal = 30;
  baseWavelengthLocal = 160;
  /** `-1` sentinel = infinite radius (matches upstream `radius` semantics). */
  baseRadiusLocal = -1;
  baseSpeedLocal = 500;
  baseBrightness = 1;
  intensity = 1;
  /** Filter target captured by the host effect on attach. */
  yageTarget: Container | undefined;
  /**
   * Reused buffer for the per-frame `center = { x, y }` writeback. `apply()`
   * runs every render frame; allocating a fresh object would churn GC
   * needlessly. The upstream setter copies x/y into its own uniform, so
   * mutating this buffer in place is safe.
   */
  private readonly _centerOut = { x: 0, y: 0 };

  override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    const target = this.yageTarget;
    if (target) {
      const wt = target.worldTransform;
      // Local axis magnitudes — robust under rotation (hypot collapses to
      // |a| / |d| in the axis-aligned case the fit transform actually uses).
      const scaleX = Math.hypot(wt.a, wt.b);
      const scaleY = Math.hypot(wt.c, wt.d);
      const sizeScale = (scaleX + scaleY) * 0.5;

      // Center: project local point → world via worldTransform, then
      // world → input-texture coords by subtracting the rasterized region's
      // world origin. That origin lives on `filterManager._activeFilterData.bounds.minX/minY`
      // — it's NOT on `input.frame.x/y`, which Pixi's TexturePool always
      // resets to 0 on allocation. Using `wt.tx/ty` instead fails on
      // component-scope sprites whose bbox starts at `position - anchor*size`,
      // and using `0` (the apparent `frame.x`) fails the moment the fit
      // transform produces letterbox bars (offsetX != 0). The internal
      // `_activeFilterData.bounds` is the only frame that's always correct
      // — accept the underscore-prefixed access; it's stable in v8.
      const worldX =
        wt.a * this.centerLocal.x + wt.c * this.centerLocal.y + wt.tx;
      const worldY =
        wt.b * this.centerLocal.x + wt.d * this.centerLocal.y + wt.ty;
      const bounds = (
        filterManager as unknown as {
          _activeFilterData?: { bounds?: { minX: number; minY: number } };
        }
      )._activeFilterData?.bounds;
      const minX = bounds?.minX ?? 0;
      const minY = bounds?.minY ?? 0;
      this._centerOut.x = worldX - minX;
      this._centerOut.y = worldY - minY;
      this.center = this._centerOut;

      // Dimensional uniforms: scale local units to input-tex pixels every
      // frame so visual ring size/speed track the user's intent at any fit
      // ratio. setIntensity is folded in here too — keeps "amplitude" and
      // "brightness" scaling on a single per-frame writeback.
      this.amplitude =
        this.baseAmplitudeLocal * this.intensity * sizeScale;
      this.brightness = this.baseBrightness * this.intensity;
      this.wavelength = this.baseWavelengthLocal * sizeScale;
      this.speed = this.baseSpeedLocal * scaleX;
      this.radius =
        this.baseRadiusLocal < 0
          ? this.baseRadiusLocal
          : this.baseRadiusLocal * sizeScale;
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
 * **Coords are in the filter target's local space** — virtual pixels for
 * scene/layer-scope effects, sprite-local for component-scope. Applies
 * uniformly to `trigger(x, y)` AND to every dimensional option
 * (`amplitude`, `wavelength`, `radius`, `speed`). The wrapper rescales
 * to the input-texture pixel space the shader actually samples in every
 * frame, using the target container's live `worldTransform`. Resize the
 * canvas, zoom the camera, attach the filter at a different scope — both
 * the trigger point and the visual ring size track your intent.
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
    const duration = options.duration ?? 1000;
    const filter = new YageShockwaveFilter({
      // Constructor needs SOMETHING for these to satisfy upstream init,
      // but our apply() override rewrites all five each frame from the
      // *Local fields below. The constructor values only matter for the
      // pre-attach window (the first frame between construction and
      // onAttach), where they're read with the upstream input-px meaning
      // and produce one frame of "wrong-scale" output before the wrapper
      // takes over. Acceptable.
      speed: options.speed ?? 500,
      amplitude: options.amplitude ?? 30,
      wavelength: options.wavelength ?? 160,
      brightness: options.brightness ?? 1,
      radius: options.radius ?? -1,
      // Park the initial ring offscreen so toggling the effect on (without
      // a trigger) shows nothing. Without this, time=0 places the ring
      // exactly at `center`, producing a stationary "bump" pinned there.
      time: PARKED_TIME,
    });
    // Stash the local-space options the wrapper's apply() reads each frame.
    filter.baseAmplitudeLocal = options.amplitude ?? 30;
    filter.baseWavelengthLocal = options.wavelength ?? 160;
    filter.baseRadiusLocal = options.radius ?? -1;
    filter.baseSpeedLocal = options.speed ?? 500;
    filter.baseBrightness = options.brightness ?? 1;

    // Shared between `buildExtras.trigger` (writes it) and `onDetach`
    // (parks the wave). The base.run-scheduled Process is auto-cancelled
    // when the effect is removed (per EffectStack lifetime contract), so
    // the cancel() call here is belt-and-suspenders against re-detach
    // ordering — what matters is parking `filter.time` so the same filter
    // instance re-attached later doesn't render a stale mid-wave on its
    // first frame.
    let inFlight: Process | undefined;

    const effect: Effect<ShockwaveHandle> = {
      filter,
      getIntensity: () => filter.intensity,
      setIntensity: (v) => {
        // Just update the multiplier — apply() folds it into amplitude +
        // brightness on the next frame. No direct uniform write here so we
        // don't fight the wrapper's per-frame conversion.
        filter.intensity = v;
      },
      onAttach: (target) => {
        // Capture the filter target so `apply()` can read its
        // `worldTransform` each frame. Without this, every dimensional
        // input falls back to the constructor-time input-px values.
        filter.yageTarget = target.displayObject;
      },
      onDetach: () => {
        inFlight?.cancel();
        inFlight = undefined;
        filter.time = PARKED_TIME;
        filter.yageTarget = undefined;
      },
      buildExtras: (base) => ({
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
                inFlight = undefined;
              },
            }),
          );
        },
      }),
    };
    return effect;
  },
});
