import { describe, it, expect, vi, beforeEach } from "vitest";

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
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;
    tint = 0xffffff;
    eventMode = "passive";
    anchor = { x: 0, y: 0, set: vi.fn() };

    addChild(child: MockContainer): MockContainer {
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
    static from = vi.fn((_tex: unknown): MockSprite => {
      const s = new MockSprite();
      s.texture = _tex;
      return s;
    });
  }

  class MockGraphics extends MockContainer {
    clear(): MockGraphics {
      return this;
    }
    rect(): MockGraphics {
      return this;
    }
    circle(): MockGraphics {
      return this;
    }
    fill(): MockGraphics {
      return this;
    }
    stroke(): MockGraphics {
      return this;
    }
  }

  class MockAnimatedSprite extends MockContainer {
    textures: unknown[];
    animationSpeed = 1;
    loop = true;
    playing = false;
    onComplete: (() => void) | null = null;
    constructor(textures: unknown[]) {
      super();
      this.textures = textures;
    }
    play(): void {
      this.playing = true;
    }
    stop(): void {
      this.playing = false;
    }
  }

  return {
    mocks: { MockContainer, MockSprite, MockGraphics, MockAnimatedSprite },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
  Graphics: mocks.MockGraphics,
  AnimatedSprite: mocks.MockAnimatedSprite,
}));

import { Transform, Vec2 } from "@yagejs/core";
import { DisplaySystem } from "./DisplaySystem.js";
import { CameraComponent } from "./CameraComponent.js";
import { SpriteComponent } from "./SpriteComponent.js";
import { GraphicsComponent } from "./GraphicsComponent.js";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

describe("DisplaySystem", () => {
  let system: DisplaySystem;

  beforeEach(() => {
    mocks.MockSprite.from.mockClear();
    system = new DisplaySystem();
  });

  function setup() {
    const ctx = createRendererTestContext();
    system._setContext(ctx.context);
    system.onRegister?.(ctx.context);
    return ctx;
  }

  it("syncs Transform position to sprite display object", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    const transform = entity.add(
      new Transform({ position: new Vec2(100, 200) }),
    );
    const spriteComp = entity.add(
      new SpriteComponent({ texture: {} as never }),
    );

    system.update();

    const sprite = spriteComp.sprite as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(sprite.position.x).toBe(transform.position.x);
    expect(sprite.position.y).toBe(transform.position.y);
  });

  it("syncs Transform rotation to sprite display object", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ rotation: 1.5 }));
    const spriteComp = entity.add(
      new SpriteComponent({ texture: {} as never }),
    );

    system.update();

    const sprite = spriteComp.sprite as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(sprite.rotation).toBe(1.5);
  });

  it("syncs Transform scale to sprite display object", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ scale: new Vec2(2, 3) }));
    const spriteComp = entity.add(
      new SpriteComponent({ texture: {} as never }),
    );

    system.update();

    const sprite = spriteComp.sprite as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(sprite.scale.x).toBe(2);
    expect(sprite.scale.y).toBe(3);
  });

  it("syncs Transform to graphics display object", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ position: new Vec2(50, 75) }));
    const gfxComp = entity.add(new GraphicsComponent());

    system.update();

    const gfx = gfxComp.graphics as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(gfx.position.x).toBe(50);
    expect(gfx.position.y).toBe(75);
  });

  it("syncs Transform to animated sprite display object", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ position: new Vec2(30, 40) }));
    const animComp = entity.add(
      new AnimatedSpriteComponent({ textures: [{} as never] }),
    );

    system.update();

    const anim = animComp.animatedSprite as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(anim.position.x).toBe(30);
    expect(anim.position.y).toBe(40);
  });

  it("skips disabled components", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ position: new Vec2(100, 200) }));
    const spriteComp = entity.add(
      new SpriteComponent({ texture: {} as never }),
    );
    spriteComp.enabled = false;

    system.update();

    const sprite = spriteComp.sprite as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(sprite.position.x).toBe(0);
    expect(sprite.position.y).toBe(0);
  });

  it("applies camera transform to layer containers", () => {
    const { scene, tree } = setup();
    const camEntity = spawnEntityInScene(scene, "camera");
    camEntity.add(
      new CameraComponent({ position: new Vec2(100, 50), zoom: 2 }),
    );

    system.update();

    // position.x = viewportWidth/2 - pos.x * zoom * ratio
    //            = 800/2 - 100*2*1 = 200
    // position.y = viewportHeight/2 - pos.y * zoom * ratio
    //            = 600/2 - 50*2*1 = 200
    const layerC = tree.defaultLayer.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(layerC.position.x).toBe(200);
    expect(layerC.position.y).toBe(200);
    expect(layerC.scale.x).toBe(2);
    expect(layerC.scale.y).toBe(2);
  });

  it("applies camera rotation (inverted) to layer containers", () => {
    const { scene, tree } = setup();
    const camEntity = spawnEntityInScene(scene, "camera");
    camEntity.add(new CameraComponent({ rotation: 0.5 }));

    system.update();

    const layerC = tree.defaultLayer.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(layerC.rotation).toBe(-0.5);
  });

  it("keeps the camera anchor centered when rotation and translation are both applied", () => {
    const { scene, tree } = setup();
    const camEntity = spawnEntityInScene(scene, "camera");
    camEntity.add(
      new CameraComponent({
        position: new Vec2(100, 0),
        rotation: Math.PI / 2,
      }),
    );

    system.update();

    const layerC = tree.defaultLayer.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(layerC.position.x).toBeCloseTo(400);
    expect(layerC.position.y).toBeCloseTo(400);
    expect(layerC.rotation).toBeCloseTo(-Math.PI / 2);
  });

  it("auto-bound cameras skip screen-space layers", () => {
    const { scene, tree } = setup();
    tree.ensureLayer({ name: "world", order: 0 });
    tree.ensureLayer({ name: "ui", order: 1000 }, { space: "screen" });

    const camEntity = spawnEntityInScene(scene, "camera");
    camEntity.add(
      new CameraComponent({ position: new Vec2(100, 50), zoom: 2 }),
    );

    system.update();

    const world = tree.get("world").container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    const ui = tree.get("ui").container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;

    // World follows the camera
    expect(world.scale.x).toBe(2);
    expect(world.position.x).toBe(200);
    // UI stays identity (auto-bind skipped it)
    expect(ui.scale.x).toBe(1);
    expect(ui.position.x).toBe(0);
    expect(ui.position.y).toBe(0);
    expect(ui.rotation).toBe(0);
  });

  it("higher-priority camera wins on shared layers", () => {
    const { scene, tree } = setup();
    tree.ensureLayer({ name: "world", order: 0 });

    // Two cameras, both targeting "world". Lower priority is processed
    // first, higher priority writes last and wins.
    const camLow = spawnEntityInScene(scene, "cam-low");
    camLow.add(
      new CameraComponent({
        position: new Vec2(100, 0),
        zoom: 1,
        priority: 0,
        bindings: [{ layer: "world" }],
      }),
    );
    const camHigh = spawnEntityInScene(scene, "cam-high");
    camHigh.add(
      new CameraComponent({
        position: new Vec2(300, 0),
        zoom: 2,
        priority: 10,
        bindings: [{ layer: "world" }],
      }),
    );

    system.update();

    const world = tree.get("world").container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    // camHigh wins: position.x = 800/2 - 300*2*1 = -200, scale = 2
    expect(world.scale.x).toBe(2);
    expect(world.position.x).toBe(-200);
  });

  it("rotateRatio=0 keeps a bound layer upright while the camera rotates", () => {
    const { scene, tree } = setup();
    tree.ensureLayer({ name: "billboards", order: 500 });

    const camEntity = spawnEntityInScene(scene, "camera");
    camEntity.add(
      new CameraComponent({
        rotation: Math.PI / 3,
        bindings: [
          { layer: "default" },
          { layer: "billboards", rotateRatio: 0 },
        ],
      }),
    );

    system.update();

    const billboards = tree.get("billboards")
      .container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(billboards.rotation).toBeCloseTo(0);
    // Default layer still rotates fully.
    const def = tree.defaultLayer.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(def.rotation).toBeCloseTo(-Math.PI / 3);
  });

  it("scaleRatio=0 keeps a bound layer at unit scale while the camera zooms", () => {
    const { scene, tree } = setup();
    tree.ensureLayer({ name: "billboards", order: 500 });

    const camEntity = spawnEntityInScene(scene, "camera");
    camEntity.add(
      new CameraComponent({
        position: new Vec2(100, 50),
        zoom: 3,
        bindings: [
          { layer: "default" },
          { layer: "billboards", scaleRatio: 0 },
        ],
      }),
    );

    system.update();

    const billboards = tree.get("billboards")
      .container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(billboards.scale.x).toBe(1);
    // Translation still tracks the camera at effScale=1:
    // position.x = 400 - 100*1*1 = 300, position.y = 300 - 50*1*1 = 250
    expect(billboards.position.x).toBe(300);
    expect(billboards.position.y).toBe(250);
  });

  it("billboard binding (rotateRatio=0, scaleRatio=0) follows position only", () => {
    const { scene, tree } = setup();
    tree.ensureLayer({ name: "billboards", order: 500 });

    const camEntity = spawnEntityInScene(scene, "camera");
    camEntity.add(
      new CameraComponent({
        position: new Vec2(100, 50),
        zoom: 2,
        rotation: Math.PI / 2,
        bindings: [
          { layer: "default" },
          { layer: "billboards", rotateRatio: 0, scaleRatio: 0 },
        ],
      }),
    );

    system.update();

    const billboards = tree.get("billboards")
      .container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(billboards.scale.x).toBe(1);
    expect(billboards.rotation).toBeCloseTo(0);
    // Translation at effScale=1, no rotation: 400 - 100 = 300, 300 - 50 = 250
    expect(billboards.position.x).toBeCloseTo(300);
    expect(billboards.position.y).toBeCloseTo(250);
  });

  it("auto-bound layers still rotate and zoom at full strength (ratios default to 1)", () => {
    // Auto-bind emits bindings with only `translateRatio: 1`; verifies the
    // new `rotateRatio`/`scaleRatio` default to 1 through the ?? coalesce.
    const { scene, tree } = setup();
    tree.ensureLayer({ name: "world", order: 0 });

    const camEntity = spawnEntityInScene(scene, "camera");
    camEntity.add(
      new CameraComponent({
        position: new Vec2(100, 50),
        zoom: 2,
        rotation: Math.PI / 4,
      }),
    );

    system.update();

    const world = tree.get("world").container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(world.scale.x).toBe(2);
    expect(world.rotation).toBeCloseTo(-Math.PI / 4);
  });

  it("partial scaleRatio dampens zoom linearly", () => {
    const { scene, tree } = setup();
    tree.ensureLayer({ name: "depth", order: 10 });

    const camEntity = spawnEntityInScene(scene, "camera");
    camEntity.add(
      new CameraComponent({
        zoom: 3,
        bindings: [{ layer: "depth", scaleRatio: 0.5 }],
      }),
    );

    system.update();

    const depth = tree.get("depth").container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    // effScale = 1 + (3 - 1) * 0.5 = 2
    expect(depth.scale.x).toBe(2);
  });

  it("explicit bindings can still target a screen-space layer", () => {
    const { scene, tree } = setup();
    tree.ensureLayer({ name: "ui", order: 1000 }, { space: "screen" });

    const camEntity = spawnEntityInScene(scene, "camera");
    camEntity.add(
      new CameraComponent({
        position: new Vec2(100, 50),
        zoom: 2,
        bindings: [{ layer: "ui", translateRatio: 1 }],
      }),
    );

    system.update();

    const ui = tree.get("ui").container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(ui.scale.x).toBe(2);
    expect(ui.position.x).toBe(200);
  });

  it("resets layers to identity when the last camera is disabled", () => {
    const { scene, tree } = setup();
    const camEntity = spawnEntityInScene(scene, "camera");
    const cam = camEntity.add(
      new CameraComponent({ position: new Vec2(100, 50), zoom: 2 }),
    );

    system.update();

    const layerC = tree.defaultLayer.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(layerC.scale.x).toBe(2);

    cam.enabled = false;
    system.update();

    expect(layerC.scale.x).toBe(1);
    expect(layerC.position.x).toBe(0);
    expect(layerC.position.y).toBe(0);
    expect(layerC.rotation).toBe(0);
  });

  it("picks up layers created after the first render", () => {
    const { scene, tree } = setup();
    const camEntity = spawnEntityInScene(scene, "camera");
    camEntity.add(
      new CameraComponent({ position: new Vec2(100, 50), zoom: 2 }),
    );

    // First pass — only the default layer exists
    system.update();

    // Add a new layer after first render
    tree.ensureLayer({ name: "world", order: 10 });

    system.update();

    const world = tree.get("world").container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(world.scale.x).toBe(2);
    expect(world.position.x).toBe(200);
  });

  it("handles multiple entities", () => {
    const { scene } = setup();

    const e1 = spawnEntityInScene(scene, "e1");
    e1.add(new Transform({ position: new Vec2(10, 20) }));
    const s1 = e1.add(new SpriteComponent({ texture: {} as never }));

    const e2 = spawnEntityInScene(scene, "e2");
    e2.add(new Transform({ position: new Vec2(30, 40) }));
    const s2 = e2.add(new SpriteComponent({ texture: {} as never }));

    system.update();

    expect(
      (s1.sprite as unknown as InstanceType<typeof mocks.MockContainer>)
        .position.x,
    ).toBe(10);
    expect(
      (s2.sprite as unknown as InstanceType<typeof mocks.MockContainer>)
        .position.x,
    ).toBe(30);
  });
});
