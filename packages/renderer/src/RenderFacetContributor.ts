import type { Component, InspectorFacetContributor } from "@yagejs/core";
import type {
  RenderFacetSnapshot,
  RenderInspectable,
} from "./internal/renderFacet.js";

// Type the renderer's `render` namespace on the Inspector's open facet map, so
// `snapshot.entities[].facets?.render` / `component.facets?.render` are typed as
// a RenderFacetSnapshot for anyone importing @yagejs/renderer. Core declares
// only the generic index signature and stays agnostic of what `render` means.
declare module "@yagejs/core" {
  interface InspectorFacets {
    /**
     * Rendered geometry (world-space bounds) + local visibility, contributed by
     * the renderer. `SplitTextComponent` publishes a wider
     * {@link import("./SplitTextComponent.js").SplitTextRenderFacet} under this
     * same key — cast when you need its `glyphs` / `visibleText` extras.
     */
    render?: RenderFacetSnapshot;
  }
}

/**
 * Publishes each graphical component's {@link RenderFacetSnapshot} into the
 * Inspector snapshot via the generic facet-contributor seam. Registered by
 * {@link import("./RendererPlugin.js").RendererPlugin} on install and removed on
 * teardown — the renderer owns the "render" namespace and the policy for which
 * component represents an entity, keeping `@yagejs/core` free of any rendering
 * concept.
 */
export class RenderFacetContributor implements InspectorFacetContributor {
  readonly namespace = "render";

  /**
   * Duck-type the renderer-internal `inspectRender()` contract off a component.
   * Returns `undefined` for components that don't paint (no hook). A hook that
   * throws is caught by the Inspector, which omits the facet.
   */
  inspectComponent(component: Component): RenderFacetSnapshot | undefined {
    const hook = (component as Partial<RenderInspectable>).inspectRender;
    return typeof hook === "function" ? hook.call(component) : undefined;
  }

  /**
   * Surface the first painted component's facet at the entity level — the
   * common single-sprite/text case. `componentFacets` arrives in component
   * insertion order (with `undefined` gaps for non-graphical components).
   */
  inspectEntity(
    componentFacets: readonly unknown[],
  ): RenderFacetSnapshot | undefined {
    return (
      (componentFacets.find((facet) => facet != null) as
        | RenderFacetSnapshot
        | undefined) ?? undefined
    );
  }
}
