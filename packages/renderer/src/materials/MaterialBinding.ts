import type { Scene } from "@yagejs/core";
import type { Sprite, Geometry, Shader, UniformGroup } from "pixi.js";
import { snapshotMaterial } from "../materials.js";
import type { SpriteMaterial } from "../materials.js";
import { SceneRenderTreeKey } from "../SceneRenderTree.js";
import { RendererKey } from "../types.js";
import { SpriteLightingKey } from "./SpriteLighting.js";
import type { SurfaceLightingInputs } from "./SpriteLighting.js";
import type { ResolvedMaps } from "./resolveMaps.js";
import type { MaterialUniforms } from "./material-shader.js";
import type { RenderLayer } from "../RenderLayer.js";

export const materialBinding = Symbol("yage.material");
export type MaterialSprite = Sprite & { [materialBinding]: MaterialBinding };

const DEFAULT_MATERIAL: SpriteMaterial = Object.freeze({
  kind: "unlit",
  emissionColor: 0xffffff,
  emissionIntensity: 0,
});

export interface MaterialGpu {
  shader: Shader;
  geometry: Geometry;
  group: UniformGroup;
  uniforms: MaterialUniforms;
  previousUniforms: Float64Array;
  vertices: Float32Array;
  capacity: number;
}

/** One sprite's shading state. Image lifetime belongs to the asset manager. */
export class MaterialBinding {
  definition: SpriteMaterial;
  active: boolean;
  inputs: SurfaceLightingInputs | undefined;
  layer: RenderLayer | undefined;
  gpu: MaterialGpu | undefined;
  scene: Scene | undefined;

  constructor(
    readonly sprite: Sprite,
    public maps: ResolvedMaps,
    material?: SpriteMaterial,
  ) {
    this.definition =
      material === undefined ? DEFAULT_MATERIAL : snapshotMaterial(material);
    this.active = material !== undefined || maps.page !== undefined;
    if (this.active) this.activate();
  }

  assertCompatible(
    scene: Scene,
    layerName: string,
    material = this.definition,
    active = this.active,
  ): void {
    if (!active) return;
    const environment = scene.tryResolveScoped(SpriteLightingKey);
    if (
      environment?.kind === "composite" ||
      (material.kind === "lit" && environment?.kind !== "surface")
    ) {
      throw new Error(
        `Sprite material: scene "${scene.name}" must select surfaceLighting() to use this material with lighting.`,
      );
    }
    const tree = scene.tryResolveScoped(SceneRenderTreeKey);
    const layer = tree?.tryGet(layerName) ?? tree?.defaultLayer;
    if (material.kind === "lit" && layer?.space === "screen") {
      throw new Error(
        `Sprite material: lit surfaces require a world-space layer, got "${layerName}".`,
      );
    }
    const renderer =
      scene.context.tryResolve(RendererKey)?.application.renderer;
    if (
      renderer &&
      (renderer.name === "canvas" ||
        ("context" in renderer && renderer.context.webGLVersion === 1))
    ) {
      throw new Error("Sprite material: WebGL2 or WebGPU is required.");
    }
  }

  attach(scene: Scene, layerName: string): void {
    this.assertCompatible(scene, layerName);
    this.scene = scene;
    const environment = scene.tryResolveScoped(SpriteLightingKey);
    this.inputs = environment?.kind === "surface" ? environment : undefined;
    const tree = scene.tryResolveScoped(SceneRenderTreeKey);
    this.layer = tree?.tryGet(layerName) ?? tree?.defaultLayer;
  }

  setMaterial(material: SpriteMaterial, layerName: string): void {
    const next = snapshotMaterial(material);
    if (this.scene) this.assertCompatible(this.scene, layerName, next, true);
    if (next.kind !== this.definition.kind) this.destroyGpu();
    this.definition = next;
    this.active = true;
    this.activate();
  }

  setMaps(maps: ResolvedMaps, layerName: string): void {
    const active = this.active || maps.page !== undefined;
    if (this.scene)
      this.assertCompatible(this.scene, layerName, this.definition, active);
    this.maps = maps;
    this.active = active;
    if (active) this.activate();
  }

  destroyGpu(): void {
    this.gpu?.shader.destroy();
    this.gpu?.geometry.destroy(true);
    this.gpu = undefined;
  }

  private activate(): void {
    Object.assign(this.sprite, { [materialBinding]: this });
    if (this.sprite.renderPipeId !== "yage-material") {
      Object.defineProperty(this.sprite, "renderPipeId", {
        value: "yage-material",
        configurable: true,
      });
      if (this.sprite.parentRenderGroup)
        this.sprite.parentRenderGroup.structureDidChange = true;
      this.sprite.didViewUpdate = true;
    }
  }
}
