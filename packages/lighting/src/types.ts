import { ServiceKey } from "@yagejs/core";
import type { Scene, Vec2Like } from "@yagejs/core";
import type { CameraComponent, RendererPlugin } from "@yagejs/renderer";
import type { LightingWorld } from "./LightingWorld.js";
import type { LightingWorldManager } from "./LightingWorldManager.js";

/** Scene-scoped lighting state registered by {@link LightingPlugin}. */
export const LightingWorldKey = new ServiceKey<LightingWorld>("lightingWorld", {
  scope: "scene",
});

/** Engine-scoped owner of every live scene's lighting world. */
export const LightingWorldManagerKey = new ServiceKey<LightingWorldManager>(
  "lightingWorldManager",
);

/** Ambient light present where no source reaches. */
export interface AmbientLightOptions {
  /** Scalar light level used by `levelAt()`. Default `0.15`. */
  level?: number;
  /** RGB tint applied by the built-in overlay renderer. Default `0xffffff`. */
  color?: number;
}

/** A spotlight cone on a {@link LightSource}. */
export interface LightConeOptions {
  /**
   * Full spread in radians, above 0 and at most a whole turn. The cone points
   * along the entity's world rotation.
   */
  angle: number;
}

/**
 * Bounced light, added over a scene's finished light buffer as a blurred copy
 * of that buffer, so light creeps past shadow edges and around corners. It is
 * a visual treatment: `LightingWorld.levelAt()` never sees it.
 */
export interface BounceLightOptions {
  /** How much of the blurred copy is added back, from 0 to 1. */
  strength: number;
  /** Blur radius of that copy, in screen pixels. */
  radius: number;
}

/** How one scene's lighting is drawn. */
export interface SceneLightingOptions {
  /**
   * Name of an entry in {@link LightingConfig.renderers}. Omit for the
   * plugin's `defaultRenderer`.
   */
  readonly renderer?: string;
  /**
   * Bounced light for this scene. Omit for {@link LightingConfig.bounce};
   * `null` leaves this scene without bounce whatever that default says.
   */
  readonly bounce?: BounceLightOptions | null;
}

/** Values passed to a renderer when its scene is attached. */
export interface LightingRendererContext {
  readonly scene: Scene;
  readonly world: LightingWorld;
  readonly renderer: RendererPlugin;
  /** Bounced light this scene is drawn with, or `null` for none. */
  readonly bounce: BounceLightOptions | null;
}

/** Current view state passed to a lighting renderer once per render phase. */
export interface LightingRenderFrame {
  /** Highest-priority enabled camera in the scene, or `null` for identity coordinates. */
  readonly camera: CameraComponent | null;
  /** Virtual viewport width. */
  readonly width: number;
  /** Virtual viewport height. */
  readonly height: number;
}

/** A per-scene lighting backend. */
export interface LightingRenderer {
  /** Synchronize the backend with the world's current lights and view. */
  render(frame: LightingRenderFrame): void;
  /** Release every resource owned by this scene's backend. */
  destroy(): void;
}

/** Creates a fresh renderer for one scene. */
export type LightingRendererFactory = (
  context: LightingRendererContext,
) => LightingRenderer;

/** Plugin configuration shared by every scene. */
export interface LightingConfig {
  /** Ambient light configuration. */
  ambient?: AmbientLightOptions;
  /**
   * The renderers scenes pick from by name, through `Scene.lighting`. Omit
   * for `{ overlay: overlayLighting() }`. A `null` entry gives light-level
   * queries without visual output.
   */
  renderers?: Readonly<Record<string, LightingRendererFactory | null>>;
  /**
   * Which entry of {@link renderers} draws a scene that names none. Default
   * `"overlay"`, and it must be a key of {@link renderers}.
   */
  defaultRenderer?: string;
  /**
   * Bounced light for every scene that sets none of its own through
   * `Scene.lighting`. Default off.
   */
  bounce?: BounceLightOptions;
}

/** A rectangular sample region for `LightingWorld.levelGridInto`. */
export interface LightGrid {
  /** World x of the region's left edge. */
  readonly x: number;
  /** World y of the region's top edge. */
  readonly y: number;
  /** Cells across. */
  readonly cols: number;
  /** Cells down. */
  readonly rows: number;
  /** Cell width in world pixels. */
  readonly cellWidth: number;
  /** Cell height in world pixels. */
  readonly cellHeight: number;
}

/** Geometry registered by a {@link LightOccluder}. */
export type LightOccluderShape =
  | { readonly type: "circle"; readonly radius: number }
  | { readonly type: "box"; readonly width: number; readonly height: number }
  | {
      readonly type: "polygon";
      readonly vertices: readonly Vec2Like[];
    };
