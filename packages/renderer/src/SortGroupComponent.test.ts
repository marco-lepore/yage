import { describe, expect, it, vi } from "vitest";

// A Pixi-faithful mock: addChild detaches the child from its previous parent
// first (real Container behaviour), so re-homing a sprite from the layer into a
// group container actually moves it instead of duplicating it.
const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = {
      x: 0,
      y: 0,
      set(this: { x: number; y: number }, ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    scale = {
      x: 1,
      y: 1,
      set(this: { x: number; y: number }, ax: number, ay?: number) {
        this.x = ax;
        this.y = ay ?? ax;
      },
    };
    rotation = 0;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;
    eventMode = "passive";

    addChild(child: MockContainer): MockContainer {
      child.parent?.removeChild(child);
      this.children.push(child);
      child.parent = this;
      return child;
    }
    removeChild(child: MockContainer): MockContainer {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parent = null;
      }
      return child;
    }
    removeChildren(): MockContainer[] {
      const removed = [...this.children];
      for (const child of removed) this.removeChild(child);
      return removed;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    sortChildren(): void {
      this.children.sort((a, b) => a.zIndex - b.zIndex);
    }
    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockSprite extends MockContainer {
    texture: unknown = null;
    static from(tex: unknown): MockSprite {
      const s = new MockSprite();
      s.texture = tex;
      return s;
    }
  }

  return { mocks: { MockContainer, MockSprite } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
}));

import { Component, Transform, Vec2 } from "@yagejs/core";
import { Container } from "pixi.js";
import { DisplaySystem } from "./DisplaySystem.js";
import { SpriteComponent } from "./SpriteComponent.js";
import {
  SortGroupComponent,
  resolveRenderParent,
} from "./SortGroupComponent.js";
import { SceneRenderTreeKey } from "./SceneRenderTree.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import { ySort } from "./ySort.js";

function setup(): ReturnType<typeof createRendererTestContext> & {
  system: DisplaySystem;
} {
  const ctx = createRendererTestContext();
  const system = new DisplaySystem();
  system._setContext(ctx.context);
  system.onRegister?.(ctx.context);
  return { ...ctx, system };
}

type Scene = ReturnType<typeof setup>["scene"];

/** Spawn a standalone sprite entity at a world Y on the given layer. */
function spawnSprite(scene: Scene, name: string, y: number, layer = "world") {
  const entity = spawnEntityInScene(scene, name);
  entity.add(new Transform({ position: new Vec2(0, y) }));
  return entity.add(new SpriteComponent({ texture: {} as never, layer }));
}

describe("SortGroupComponent", () => {
  it("renders a multi-part entity as one unit — no interleave by Y", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "world", order: 0, sort: ySort });
    const layer = tree.get("world").container;

    // Knight: body at y=100, plus a held weapon child offset to world y=108.
    const knight = spawnEntityInScene(scene, "knight");
    knight.add(new Transform({ position: new Vec2(0, 100) }));
    knight.add(new SortGroupComponent({ layer: "world" }));
    const body = knight.add(
      new SpriteComponent({ texture: {} as never, layer: "world" }),
    );
    const weaponEntity = knight.spawnChild("weapon");
    weaponEntity.add(new Transform({ position: new Vec2(0, 8) }));
    const weapon = weaponEntity.add(
      new SpriteComponent({ texture: {} as never, layer: "world" }),
    );

    // Unrelated entity whose Y lands between the knight's body and weapon.
    const between = spawnSprite(scene, "between", 104);

    system.update();

    const group = knight.get(SortGroupComponent).container;

    // Body + weapon live inside the group; the group + the loose sprite are
    // the only direct children of the layer.
    expect(group.children).toEqual([body.sprite, weapon.sprite]);
    expect(layer.children).toContain(group);
    expect(layer.children).toContain(between.sprite);
    expect(layer.children).not.toContain(body.sprite);
    expect(layer.children).not.toContain(weapon.sprite);

    // The group sorts as one unit at the body's depth; the loose sprite at 104
    // resolves entirely in front of it rather than between its parts.
    expect(group.zIndex).toBe(100);
    expect(between.sprite.zIndex).toBe(104);

    layer.sortChildren();
    expect(layer.children).toEqual([group, between.sprite]);
  });

  it("keeps member insertion order and honours manual zIndex by default", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "world", order: 0, sort: ySort });

    const knight = spawnEntityInScene(scene, "knight");
    knight.add(new Transform({ position: new Vec2(0, 100) }));
    knight.add(new SortGroupComponent({ layer: "world" }));
    const body = knight.add(
      new SpriteComponent({ texture: {} as never, layer: "world" }),
    );
    const capeEntity = knight.spawnChild("cape");
    capeEntity.add(new Transform({ position: new Vec2(0, 0) }));
    const cape = capeEntity.add(
      new SpriteComponent({ texture: {} as never, layer: "world" }),
    );
    // Author intent: the cape draws behind the body regardless of position.
    cape.sprite.zIndex = -1;

    system.update();

    const group = knight.get(SortGroupComponent).container;
    // No innerSort → member zIndex untouched; manual -1 stands.
    expect(cape.sprite.zIndex).toBe(-1);
    expect(body.sprite.zIndex).toBe(0);
    group.sortChildren();
    expect(group.children).toEqual([cape.sprite, body.sprite]);
  });

  it("orders members by innerSort when provided", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "world", order: 0, sort: ySort });

    const knight = spawnEntityInScene(scene, "knight");
    knight.add(new Transform({ position: new Vec2(0, 100) }));
    knight.add(new SortGroupComponent({ layer: "world", innerSort: ySort }));
    const body = knight.add(
      new SpriteComponent({ texture: {} as never, layer: "world" }),
    );
    const plumeEntity = knight.spawnChild("plume");
    plumeEntity.add(new Transform({ position: new Vec2(0, 8) }));
    const plume = plumeEntity.add(
      new SpriteComponent({ texture: {} as never, layer: "world" }),
    );

    system.update();

    // Members re-keyed by their own world Y while the group stays one unit.
    expect(body.sprite.zIndex).toBe(100);
    expect(plume.sprite.zIndex).toBe(108);
  });

  it("keys a sprite-less group off the owning entity's Transform", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "world", order: 0, sort: ySort });

    // Pure logical parent — no sprite of its own, just a grouped child.
    const mount = spawnEntityInScene(scene, "mount");
    mount.add(new Transform({ position: new Vec2(0, 50) }));
    mount.add(new SortGroupComponent({ layer: "world" }));
    const riderEntity = mount.spawnChild("rider");
    riderEntity.add(new Transform({ position: new Vec2(0, 4) }));
    riderEntity.add(
      new SpriteComponent({ texture: {} as never, layer: "world" }),
    );

    system.update();

    const group = mount.get(SortGroupComponent).container;
    expect(group.zIndex).toBe(50); // proxy at the owner's world position
  });

  it("leaves visuals on a different layer outside the group", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "world", order: 0, sort: ySort });
    tree.ensureLayer({ name: "ground", order: -1, sort: ySort });
    const ground = tree.get("ground").container;

    const knight = spawnEntityInScene(scene, "knight");
    knight.add(new Transform({ position: new Vec2(0, 100) }));
    knight.add(new SortGroupComponent({ layer: "world" }));
    knight.add(new SpriteComponent({ texture: {} as never, layer: "world" }));
    // A shadow that should sort independently on its own layer.
    const shadowEntity = knight.spawnChild("shadow");
    shadowEntity.add(new Transform({ position: new Vec2(0, 0) }));
    const shadow = shadowEntity.add(
      new SpriteComponent({ texture: {} as never, layer: "ground" }),
    );

    system.update();

    const group = knight.get(SortGroupComponent).container;
    expect(ground.children).toContain(shadow.sprite);
    expect(group.children).not.toContain(shadow.sprite);
  });

  it("re-homes already-added subtree visuals when added late", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "world", order: 0, sort: ySort });
    const layer = tree.get("world").container;

    // Visuals added BEFORE the group (and a child spawned first too).
    const knight = spawnEntityInScene(scene, "knight");
    knight.add(new Transform({ position: new Vec2(0, 100) }));
    const body = knight.add(
      new SpriteComponent({ texture: {} as never, layer: "world" }),
    );
    const armEntity = knight.spawnChild("arm");
    armEntity.add(new Transform({ position: new Vec2(0, 4) }));
    const arm = armEntity.add(
      new SpriteComponent({ texture: {} as never, layer: "world" }),
    );
    expect(layer.children).toContain(body.sprite); // currently flat

    // Adding the group now pulls the whole subtree in.
    knight.add(new SortGroupComponent({ layer: "world" }));
    const group = knight.get(SortGroupComponent).container;

    expect(group.children).toEqual([body.sprite, arm.sprite]);
    expect(layer.children).not.toContain(body.sprite);
    expect(layer.children).not.toContain(arm.sprite);

    system.update();
    expect(group.zIndex).toBe(100);
  });

  it("returns members to the layer when the group is removed", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "world", order: 0, sort: ySort });
    const layer = tree.get("world").container;

    const knight = spawnEntityInScene(scene, "knight");
    knight.add(new Transform({ position: new Vec2(0, 100) }));
    knight.add(new SortGroupComponent({ layer: "world" }));
    const body = knight.add(
      new SpriteComponent({ texture: {} as never, layer: "world" }),
    );
    const group = knight.get(SortGroupComponent).container;
    expect(group.children).toContain(body.sprite);

    knight.remove(SortGroupComponent);

    // The wrapper is gone; the sprite is back as a direct layer child.
    expect(layer.children).not.toContain(group);
    expect(layer.children).toContain(body.sprite);

    // And it still sorts normally afterwards.
    system.update();
    expect(body.sprite.zIndex).toBe(100);
  });

  it("lets a custom LayerRenderable join a group via resolveRenderParent", () => {
    const { scene, tree, system } = setup();
    tree.ensureLayer({ name: "world", order: 0, sort: ySort });

    // A user-authored visual component that follows the documented extension
    // path: implement renderObject/layerName, route through resolveRenderParent.
    class Trail extends Component {
      readonly layerName = "world";
      readonly renderObject = new Container();
      onAdd(): void {
        resolveRenderParent(
          this.entity,
          this.layerName,
          this.use(SceneRenderTreeKey),
        ).addChild(this.renderObject);
      }
    }

    const knight = spawnEntityInScene(scene, "knight");
    knight.add(new Transform({ position: new Vec2(0, 100) }));
    knight.add(new SortGroupComponent({ layer: "world" }));
    const trailEntity = knight.spawnChild("trail");
    trailEntity.add(new Transform({ position: new Vec2(0, 5) }));
    const trail = trailEntity.add(new Trail());

    system.update();

    // Routed straight into the group on its initial add — not stranded on the
    // layer waiting for the next regroup.
    const group = knight.get(SortGroupComponent).container;
    expect(group.children).toContain(trail.renderObject);
    expect(tree.get("world").container.children).not.toContain(
      trail.renderObject,
    );
  });

  describe("undeclared layer", () => {
    it("warns once and renders into the default layer instead of throwing", () => {
      const { scene, tree, system } = setup();
      // Only the auto-created "default" layer exists; "fx" is never declared.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const entity = spawnEntityInScene(scene, "spark");
      entity.add(new Transform({ position: new Vec2(0, 0) }));
      const graphics = entity.add(
        new SpriteComponent({ texture: {} as never, layer: "fx" }),
      );

      system.update();

      const defaultContainer = tree.defaultLayer.container;
      expect(defaultContainer.children).toContain(graphics.sprite);

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0]![0] as string;
      expect(message).toContain("spark");
      expect(message).toContain("fx");
      expect(message).toContain("test-scene");
      // The actionable remedy is part of the warning's contract.
      expect(message).toContain('{ name: "fx", order: 0 }');
      expect(message).toContain('"default"');

      warn.mockRestore();
    });

    it("warns for each built-in visual that targets an undeclared layer", () => {
      const { scene, system } = setup();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const a = spawnEntityInScene(scene, "a");
      a.add(new SpriteComponent({ texture: {} as never, layer: "fx" }));
      const b = spawnEntityInScene(scene, "b");
      b.add(new SpriteComponent({ texture: {} as never, layer: "fx" }));

      system.update();

      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });

    it("leaves the enclosing-group path unwarned and ungrouped on a missing layer", () => {
      const { scene, tree, system } = setup();
      tree.ensureLayer({ name: "world", order: 0, sort: ySort });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      // A group on "world" plus a same-layer visual: the visual joins the
      // group via the ancestor branch and never reaches the tryGet fallback.
      const knight = spawnEntityInScene(scene, "knight");
      knight.add(new Transform({ position: new Vec2(0, 100) }));
      knight.add(new SortGroupComponent({ layer: "world" }));
      const body = knight.add(
        new SpriteComponent({ texture: {} as never, layer: "world" }),
      );

      system.update();

      const group = knight.get(SortGroupComponent).container;
      expect(group.children).toContain(body.sprite);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
