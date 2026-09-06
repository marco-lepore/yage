import { describe, expect, it } from "vitest";
import { Component, Entity, createMockScene } from "@yagejs/core";
import { applyPlacementLayer } from "./layer.js";

/** Stands in for a renderer visual: the two members a level duck-types. */
class Painted extends Component {
  private _layerName: string;

  constructor(layer = "default") {
    super();
    this._layerName = layer;
  }

  get layerName(): string {
    return this._layerName;
  }

  setLayer(name: string): void {
    this._layerName = name;
  }
}

/**
 * A second visual on the same entity. An entity holds one component per class,
 * so a type with two visuals declares two classes.
 */
class Shadow extends Painted {}

/** A component with neither member, which the walk has to step over. */
class Silent extends Component {}

function entityWith(...components: Component[]): Entity {
  const scene = createMockScene().scene;
  const entity = scene.spawn(Entity);
  for (const component of components) entity.add(component);
  return entity;
}

describe("applyPlacementLayer", () => {
  it("moves every visual the type left on the default layer", () => {
    const body = new Painted();
    const shadow = new Shadow();
    const entity = entityWith(body, shadow, new Silent());

    applyPlacementLayer(entity, "props");

    expect(body.layerName).toBe("props");
    expect(shadow.layerName).toBe("props");
  });

  it("leaves a visual whose type chose a layer of its own", () => {
    const body = new Painted();
    const bar = new Shadow("ui");
    const entity = entityWith(body, bar);

    applyPlacementLayer(entity, "props");

    expect(body.layerName).toBe("props");
    expect(bar.layerName).toBe("ui");
  });

  it("does nothing on an entity with no visual at all", () => {
    const entity = entityWith(new Silent());

    expect(() => {
      applyPlacementLayer(entity, "props");
    }).not.toThrow();
  });
});
