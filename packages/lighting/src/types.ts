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

/** Values passed to a renderer when its scene is attached. */
export interface LightingRendererContext {
  readonly scene: Scene;
  readonly world: LightingWorld;
  readonly renderer: RendererPlugin;
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
   * Per-scene renderer factory. Omit for {@link OverlayLightingRenderer};
   * pass `null` for light-level queries without visual output.
   */
  renderer?: LightingRendererFactory | null;
}

/** Geometry registered by a {@link LightOccluder}. */
export type LightOccluderShape =
  | { readonly type: "circle"; readonly radius: number }
  | { readonly type: "box"; readonly width: number; readonly height: number }
  | {
      readonly type: "polygon";
      readonly vertices: readonly Vec2Like[];
    };
