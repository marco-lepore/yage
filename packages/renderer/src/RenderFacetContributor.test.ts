import { describe, it, expect } from "vitest";
import type { Component } from "@yagejs/core";
import { RenderFacetContributor } from "./RenderFacetContributor.js";
import type { RenderFacetSnapshot } from "./internal/renderFacet.js";

// The contributor only duck-types `inspectRender()` off a component and picks a
// representative facet for the entity — no Pixi needed, so these fakes are plain
// objects cast to Component. (The bounds math itself is covered by
// renderFacet.test.ts; the per-component hooks by each component's own suite.)
function fakeComponent(facet?: RenderFacetSnapshot): Component {
  return (facet ? { inspectRender: () => facet } : {}) as unknown as Component;
}

const sample: RenderFacetSnapshot = {
  bounds: { x: 1, y: 2, width: 3, height: 4 },
  visible: true,
};

describe("RenderFacetContributor", () => {
  const contributor = new RenderFacetContributor();

  it("publishes under the 'render' namespace", () => {
    expect(contributor.namespace).toBe("render");
  });

  it("returns a graphical component's render facet", () => {
    expect(contributor.inspectComponent(fakeComponent(sample))).toEqual(sample);
  });

  it("returns undefined for a component without inspectRender()", () => {
    expect(contributor.inspectComponent(fakeComponent())).toBeUndefined();
  });

  it("surfaces the first painted component as the entity-level facet", () => {
    const first: RenderFacetSnapshot = { bounds: null, visible: false };
    // Insertion order with a non-graphical gap up front; the first non-null
    // facet wins — never the alphabetically-sorted one.
    expect(contributor.inspectEntity([undefined, first, sample])).toBe(first);
  });

  it("returns undefined when no component painted", () => {
    expect(
      contributor.inspectEntity([undefined, undefined]),
    ).toBeUndefined();
  });
});
