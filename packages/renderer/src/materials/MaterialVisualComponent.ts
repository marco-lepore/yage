import { VisualComponent } from "../VisualComponent.js";
import type { DisplaySprite } from "../public-types.js";
import type { SpriteMaterial, SpriteMaps } from "../materials.js";
import { MaterialBinding } from "./MaterialBinding.js";
import type { ResolvedMaps } from "./resolveMaps.js";
import type { RenderFacetSnapshot } from "../internal/renderFacet.js";

/** Shared material attachment for sprite components, including animated sprites. */
export abstract class MaterialVisualComponent extends VisualComponent {
  abstract override readonly renderObject: DisplaySprite;
  protected surface!: MaterialBinding;

  protected initializeMaterial(
    maps: ResolvedMaps,
    material?: SpriteMaterial,
  ): void {
    this.surface = new MaterialBinding(this.renderObject, maps, material);
  }

  get material(): SpriteMaterial {
    return this.surface.definition;
  }
  get maps(): SpriteMaps {
    return this.surface.maps.refs;
  }

  /** Replace this sprite's immutable shading settings. */
  setMaterial(material: SpriteMaterial): void {
    this.surface.setMaterial(material, this.layerName);
  }

  override onAdd(): void {
    this.surface.attach(this.scene, this.layerName);
    super.onAdd();
  }

  override setLayer(name: string): void {
    if (this.surface.scene)
      this.surface.assertCompatible(this.surface.scene, name);
    super.setLayer(name);
    if (this.surface.scene) this.surface.attach(this.surface.scene, name);
  }

  override inspectRender(): RenderFacetSnapshot<{
    material?: SpriteMaterial;
    maps?: Record<string, string>;
    lighting?: string;
    source?: string;
    frame?: {
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
    };
    frameIndex?: number;
  }> {
    const base = super.inspectRender();
    if (!this.surface.active) return base;
    const maps: Record<string, string> = {};
    for (const [role, ref] of Object.entries(this.maps))
      maps[role] = typeof ref === "string" ? ref : ref.path;
    const texture = this.renderObject.texture;
    const frame = texture.frame;
    return {
      ...base,
      material: this.material,
      maps,
      lighting: this.surface.inputs?.kind ?? "none",
      source: texture.source.label,
      frame: {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        rotation: texture.rotate,
      },
    };
  }

  override onDestroy(): void {
    super.onDestroy();
    this.surface.destroyGpu();
  }
}
