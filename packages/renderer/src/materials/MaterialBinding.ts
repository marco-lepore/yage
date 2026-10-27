import type { Scene } from "@yagejs/core";
import type { Sprite, Geometry, Shader, UniformGroup } from "pixi.js";
import { assertMaterial, litMaterial } from "../materials.js";
import type { SpriteMaps, SpriteMaterial } from "../materials.js";
import { SceneRenderTreeKey } from "../SceneRenderTree.js";
import { RendererKey } from "../types.js";
import { SpriteLightingKey } from "./SpriteLighting.js";
import type { SurfaceLightingInputs } from "./SpriteLighting.js";
import type { ResolvedMaps } from "./resolveMaps.js";
import type { MaterialUniforms } from "./material-shader.js";
import type { RenderLayer } from "../RenderLayer.js";

export const materialBinding = Symbol("yage.material");
export type MaterialSprite = Sprite & { [materialBinding]: MaterialBinding };

export const MATERIAL_PIPE = "yage-material";

/** What a sprite without a material of its own draws with on a surface-lit world layer. */
const SCENE_DEFAULT = litMaterial();

export interface MaterialGpu {
  shader: Shader;
  geometry: Geometry;
  group: UniformGroup;
  uniforms: MaterialUniforms;
  previousUniforms: Float64Array;
  vertices: Float32Array;
  capacity: number;
}

/**
 * One sprite's shading state. It decides which material the sprite draws
 * with in its scene and layer, and routes the sprite to the material pipe or
 * back to Pixi's own. Image lifetime belongs to the asset manager.
 */
export class MaterialBinding {
  /** The material the sprite draws with, or `undefined` for Pixi's own pipe. */
  material: SpriteMaterial | undefined;
  /** Lighting code and data for a lit material. */
  lighting: SurfaceLightingInputs | undefined;
  /** The layer whose container frames the sprite's world position. */
  layer: RenderLayer | undefined;
  gpu: MaterialGpu | undefined;
  private scene: Scene | undefined;
  private readonly nativePipe: string;

  constructor(
    readonly sprite: Sprite,
    public maps: ResolvedMaps,
    /** The material the game set, or `undefined` to follow the scene. */
    public explicit: SpriteMaterial | undefined,
  ) {
    assertMaterial(explicit);
    this.nativePipe = sprite.renderPipeId;
    Object.assign(sprite, { [materialBinding]: this });
  }

  attach(scene: Scene, layerName: string): void {
    this.scene = scene;
    this.resolve(layerName, this.explicit, this.maps);
  }

  setMaterial(material: SpriteMaterial | undefined, layerName: string): void {
    assertMaterial(material);
    this.resolve(layerName, material, this.maps);
  }

  setMaps(maps: ResolvedMaps, layerName: string): void {
    this.resolve(layerName, this.explicit, maps);
  }

  setLayer(layerName: string): void {
    this.resolve(layerName, this.explicit, this.maps);
  }

  /** Throw if the scene's lighting cannot honor these maps. */
  assertMaps(maps: SpriteMaps | undefined): void {
    const scene = this.scene;
    if (!scene || !(maps?.normal || maps?.specular || maps?.emission)) return;
    if (scene.tryResolveScoped(SpriteLightingKey)?.kind === "composite") {
      throw new Error(
        `Sprite maps: scene "${scene.name}" must select surfaceLighting() to use companion maps.`,
      );
    }
  }

  destroyGpu(): void {
    this.gpu?.shader.destroy();
    this.gpu?.geometry.destroy(true);
    this.gpu = undefined;
  }

  /** Validate a change against the scene, then apply it. Nothing changes on a throw. */
  private resolve(
    layerName: string,
    explicit: SpriteMaterial | undefined,
    maps: ResolvedMaps,
  ): void {
    const scene = this.scene;
    if (!scene) {
      this.explicit = explicit;
      this.maps = maps;
      return;
    }
    const environment = scene.tryResolveScoped(SpriteLightingKey);
    const surface = environment?.kind === "surface" ? environment : undefined;
    const tree = scene.tryResolveScoped(SceneRenderTreeKey);
    const layer = tree?.tryGet(layerName) ?? tree?.defaultLayer;
    const world = (layer?.space ?? "world") === "world";
    if (explicit && environment?.kind === "composite") {
      throw new Error(
        `Sprite material: scene "${scene.name}" must select surfaceLighting() to use sprite materials.`,
      );
    }
    this.assertMaps(maps.refs);
    if (explicit?.kind === "lit" && !surface) {
      throw new Error(
        `Sprite material: scene "${scene.name}" must select surfaceLighting() to use a lit material.`,
      );
    }
    if (explicit?.kind === "lit" && !world) {
      throw new Error(
        `Sprite material: lit surfaces require a world-space layer, got "${layerName}".`,
      );
    }
    const material = explicit ?? (surface && world ? SCENE_DEFAULT : undefined);
    if (material) assertBackend(scene);

    this.explicit = explicit;
    this.maps = maps;
    this.layer = layer;
    // The lit shader embeds the scene's lighting code; the unlit one does not.
    if (material?.kind !== this.material?.kind) this.destroyGpu();
    this.material = material;
    this.lighting = material?.kind === "lit" ? surface : undefined;
    this.route(material ? MATERIAL_PIPE : this.nativePipe);
  }

  private route(pipe: string): void {
    const sprite = this.sprite;
    if (sprite.renderPipeId === pipe) return;
    Object.defineProperty(sprite, "renderPipeId", {
      value: pipe,
      configurable: true,
    });
    if (sprite.parentRenderGroup)
      sprite.parentRenderGroup.structureDidChange = true;
    sprite.didViewUpdate = true;
  }
}

function assertBackend(scene: Scene): void {
  if (scene.context.resolve(RendererKey).capabilities.backend === "webgl1")
    throw new Error("Sprite material: WebGL2 or WebGPU is required.");
}
