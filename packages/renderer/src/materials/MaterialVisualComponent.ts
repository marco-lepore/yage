import { VisualComponent } from "../VisualComponent.js";
import type { DisplaySprite } from "../public-types.js";
import type { SpriteMaterial, SpriteMaps } from "../materials.js";
import { MaterialBinding } from "./MaterialBinding.js";
import type { ResolvedMaps } from "./resolveMaps.js";
import type { RenderFacetSnapshot } from "../internal/renderFacet.js";

/** Shared material attachment for sprite components, including animated sprites. */
export abstract class MaterialVisualComponent extends VisualComponent {
  abstract override readonly renderObject: DisplaySprite;
  protected binding!: MaterialBinding;

  protected initializeMaterial(
    maps: ResolvedMaps,
    material: SpriteMaterial | undefined,
  ): void {
    this.binding = new MaterialBinding(this.renderObject, maps, material);
  }

  /**
   * The material set through the `material` option or {@link setMaterial}.
   * `undefined` follows the scene: lit on a world layer of a
   * `surfaceLighting()` scene, ordinary drawing everywhere else.
   */
  get material(): SpriteMaterial | undefined {
    return this.binding.explicit;
  }

  /** The companion images drawn with the current color image. */
  get maps(): SpriteMaps {
    return this.binding.maps.refs;
  }

  /** Replace this sprite's material. `undefined` returns it to the scene's default. */
  setMaterial(material: SpriteMaterial | undefined): void {
    this.binding.setMaterial(material, this.layerName);
  }

  override onAdd(): void {
    this.binding.attach(this.scene, this.layerName);
    super.onAdd();
  }

  override setLayer(name: string): void {
    if (name === this.layerName) return;
    this.binding.setLayer(name);
    super.setLayer(name);
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
    const material = this.binding.material;
    if (!material) return base;
    const maps: Record<string, string> = {};
    for (const [role, ref] of Object.entries(this.maps))
      maps[role] = typeof ref === "string" ? ref : ref.path;
    const texture = this.renderObject.texture;
    const frame = texture.frame;
    return {
      ...base,
      material,
      maps,
      lighting: this.binding.lighting?.kind ?? "none",
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
    this.binding.destroyGpu();
  }
}
