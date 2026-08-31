import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { ZoomBlurFilter } from "pixi-filters";
import type { Container, FilterSystem, RenderSurface, Texture } from "pixi.js";
import type { ZoomBlurHandle } from "./handles.js";
import {
  validateFinite,
  validateInteger,
  validateMinimum,
  validatePoint,
} from "./validate.js";

/** Options for the {@link zoomBlur} preset. */
export interface ZoomBlurOptions {
  /** Blur strength. Positive values streak outward; negative values pull inward. Default: 0.12. */
  strength?: number;
  /** Center in the effect host's local coordinates. Omit for the host center. */
  center?: { x: number; y: number };
  /** Unblurred inner radius in host-local pixels. Default: 0. */
  innerRadius?: number;
  /** Outer radius in host-local pixels. Negative means unlimited. Default: -1. */
  radius?: number;
  /** Grow a finite outer radius from the center as intensity rises. Default: false. */
  expandFromCenter?: boolean;
  /** Maximum shader sample count. Default: 32. */
  maxKernelSize?: number;
}

class YageZoomBlurFilter extends ZoomBlurFilter {
  intensity = 1;
  baseStrength: number;
  centerLocal: { x: number; y: number } | undefined;
  innerRadiusLocal: number;
  radiusLocal: number;
  expandFromCenter: boolean;
  yageTarget: Container | undefined;
  private readonly centerOut = { x: 0, y: 0 };

  constructor(options: ZoomBlurOptions) {
    const strength = validateFinite(
      "zoomBlur",
      "strength",
      options.strength ?? 0.12,
    );
    const innerRadius = validateMinimum(
      "zoomBlur",
      "innerRadius",
      options.innerRadius ?? 0,
      0,
    );
    const radius = validateFinite("zoomBlur", "radius", options.radius ?? -1);
    super({
      strength,
      center: { x: 0, y: 0 },
      innerRadius,
      radius,
      maxKernelSize: validateInteger(
        "zoomBlur",
        "maxKernelSize",
        options.maxKernelSize ?? 32,
        1,
      ),
    });
    this.baseStrength = strength;
    this.centerLocal = options.center
      ? { ...validatePoint("zoomBlur", "center", options.center) }
      : undefined;
    this.innerRadiusLocal = innerRadius;
    this.radiusLocal = radius;
    this.expandFromCenter = options.expandFromCenter ?? false;
  }

  override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    const target = this.yageTarget;
    const transform = target?.worldTransform;
    const scaleX = transform ? Math.hypot(transform.a, transform.b) : 1;
    const scaleY = transform ? Math.hypot(transform.c, transform.d) : 1;
    const sizeScale = (scaleX + scaleY) * 0.5;
    const center = this.centerLocal;
    if (target && transform && center) {
      const worldX =
        transform.a * center.x + transform.c * center.y + transform.tx;
      const worldY =
        transform.b * center.x + transform.d * center.y + transform.ty;
      const bounds = (
        filterManager as unknown as {
          _activeFilterData?: { bounds?: { minX: number; minY: number } };
        }
      )._activeFilterData?.bounds;
      this.centerOut.x = worldX - (bounds?.minX ?? 0);
      this.centerOut.y = worldY - (bounds?.minY ?? 0);
    } else {
      this.centerOut.x = input.frame.width * 0.5;
      this.centerOut.y = input.frame.height * 0.5;
    }
    this.center = this.centerOut;
    this.strength = this.baseStrength * this.intensity;
    this.innerRadius = this.innerRadiusLocal * sizeScale;
    const radiusProgress = Math.pow(
      Math.min(1, Math.max(0, this.intensity)),
      1.35,
    );
    this.radius =
      this.radiusLocal < 0
        ? -1
        : Math.max(
            1,
            this.radiusLocal *
              sizeScale *
              (this.expandFromCenter ? radiusProgress : 1),
          );
    super.apply(filterManager, input, output, clearMode);
  }
}

/** Radial speed blur centered on a host-local point. */
export const zoomBlur = defineEffect<ZoomBlurHandle, ZoomBlurOptions>({
  name: "yage:zoomBlur",
  factory: (options) => {
    const filter = new YageZoomBlurFilter(options);
    const effect: Effect<ZoomBlurHandle> = {
      filter,
      getIntensity: () => filter.intensity,
      setIntensity: (value) => {
        filter.intensity = validateFinite("zoomBlur", "intensity", value);
        filter.strength = filter.baseStrength * filter.intensity;
      },
      onAttach: ({ displayObject }) => {
        filter.yageTarget = displayObject;
      },
      onDetach: () => {
        filter.yageTarget = undefined;
      },
      buildExtras: () => ({
        setStrength: (value: number) => {
          filter.baseStrength = validateFinite("zoomBlur", "strength", value);
          filter.strength = filter.baseStrength * filter.intensity;
        },
        setCenter: (x: number, y: number) => {
          filter.centerLocal = validatePoint("zoomBlur", "center", { x, y });
        },
        useHostCenter: () => {
          filter.centerLocal = undefined;
        },
        setRadii: (innerRadius: number, radius: number) => {
          filter.innerRadiusLocal = validateMinimum(
            "zoomBlur",
            "innerRadius",
            innerRadius,
            0,
          );
          filter.radiusLocal = validateFinite("zoomBlur", "radius", radius);
        },
        setExpandFromCenter: (value: boolean) => {
          filter.expandFromCenter = value;
        },
      }),
    };
    return effect;
  },
});
