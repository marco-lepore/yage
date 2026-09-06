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

  class MockText extends MockContainer {
    text: string;
    style: Record<string, unknown>;
    constructor(init: { text: string; style?: Record<string, unknown> }) {
      super();
      this.text = init.text;
      this.style = init.style ?? {};
    }
  }

  return {
    mocks: {
      MockContainer,
      MockSprite,
      MockGraphics,
      MockAnimatedSprite,
      MockText,
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
  Graphics: mocks.MockGraphics,
  AnimatedSprite: mocks.MockAnimatedSprite,
  Text: mocks.MockText,
}));

// This suite only cares that Transform syncs onto whatever display object a
// component creates — not frame content — so resolveFrames is stubbed to
// skip the real sliceSheet/Texture/Assets path this file doesn't mock.
vi.mock("./spritesheet.js", () => ({
  resolveFrames: () => [{}],
}));

import { Transform, Vec2, ErrorBoundaryKey } from "@yagejs/core";
import { Graphics } from "pixi.js";
import { DisplaySystem } from "./DisplaySystem.js";
import { CameraComponent } from "./CameraComponent.js";
import { SpriteComponent } from "./SpriteComponent.js";
import { GraphicsComponent } from "./GraphicsComponent.js";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import { TextComponent } from "./TextComponent.js";
import { SortGroupComponent } from "./SortGroupComponent.js";
import { VisualComponent } from "./VisualComponent.js";
import type { DisplayContainer } from "./public-types.js";
import { ySort } from "./ySort.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

/**
 * Stands in for a `VisualComponent` subclass declared in another package —
 * the tilemap's component is one — so the sync path is covered without a
 * dependency on that package.
 */
class ProbeVisual extends VisualComponent {
  readonly renderObject: DisplayContainer;

  constructor() {
    super(undefined);
    this.renderObject = new Graphics();
  }
}

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

  it("combines visual modifiers with the current transform every frame", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    const transform = entity.add(
      new Transform({
        position: new Vec2(10, 20),
        rotation: 0.25,
        scale: new Vec2(2, 3),
      }),
    );
    const visual = entity.add(new SpriteComponent({ texture: {} as never }));
    const modifier = visual.modifiers.addTransform({
      position: { x: 4, y: -2 },
      rotation: 0.5,
      scale: { x: 3, y: 0.5 },
    });

    system.update();
    const sprite = visual.sprite as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(sprite.position).toMatchObject({ x: 14, y: 18 });
    expect(sprite.rotation).toBe(0.75);
    expect(sprite.scale).toMatchObject({ x: 6, y: 1.5 });

    transform.position = new Vec2(100, 200);
    transform.rotation = 1;
    transform.scale = new Vec2(4, 5);
    system.update();
    expect(sprite.position).toMatchObject({ x: 104, y: 198 });
    expect(sprite.rotation).toBe(1.5);
    expect(sprite.scale).toMatchObject({ x: 12, y: 2.5 });

    modifier.remove();
    system.update();
    expect(sprite.position).toMatchObject({ x: 100, y: 200 });
    expect(sprite.rotation).toBe(1);
    expect(sprite.scale).toMatchObject({ x: 4, y: 5 });
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
      new AnimatedSpriteComponent({
        source: { sheet: "x.png", frameWidth: 1 },
      }),
    );

    system.update();

    const anim = animComp.animatedSprite as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(anim.position.x).toBe(30);
    expect(anim.position.y).toBe(40);
  });

  it("syncs Transform to text display object", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ position: new Vec2(12, 34) }));
    const textComp = entity.add(new TextComponent({ text: "hello" }));

    system.update();

    const txt = textComp.text as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(txt.position.x).toBe(12);
    expect(txt.position.y).toBe(34);
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

  it("combines camera modifiers with current camera values", () => {
    const { scene, tree } = setup();
    const camEntity = spawnEntityInScene(scene, "camera");
    const camera = camEntity.add(
      new CameraComponent({ position: new Vec2(100, 50), zoom: 2 }),
    );
    const modifier = camera.modifiers.add({
      position: { x: 20, y: 0 },
      rotation: 0.5,
      zoom: 1.5,
    });

    system.update();
    const layer = tree.defaultLayer.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(layer.scale.x).toBe(3);
    expect(layer.rotation).toBe(-0.5);

    camera.zoom = 4;
    modifier.remove();
    system.update();
    expect(layer.scale.x).toBe(4);
    expect(layer.rotation).toBeCloseTo(0);
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

  /**
   * A dormant entity is drawn by writing its pose and visibility straight onto
   * the render object, which works only because this pass never touches one —
   * the queries exclude a dormant entity. These cases pin that outcome, so a
   * change to how the pass selects entities fails here.
   */
  describe("dormant entities", () => {
    it("leaves an externally written pose, visibility and opacity alone", () => {
      const { scene } = setup();
      const entity = scene.spawn("dormant", { active: false });
      // Deliberately unlike the pose written below: a pass that synced dormant
      // entities would overwrite the written one with this.
      entity.add(new Transform({ position: new Vec2(100, 200) }));
      const spriteComp = entity.add(
        new SpriteComponent({ texture: {} as never }),
      );

      const sprite = spriteComp.sprite as unknown as InstanceType<
        typeof mocks.MockContainer
      >;
      sprite.position.set(10, 20);
      sprite.rotation = 0.5;
      sprite.scale.set(2, 3);
      sprite.visible = true;
      sprite.alpha = 0.25;

      system.update();

      expect(sprite.position).toMatchObject({ x: 10, y: 20 });
      expect(sprite.rotation).toBe(0.5);
      expect(sprite.scale).toMatchObject({ x: 2, y: 3 });
      expect(sprite.visible).toBe(true);
      expect(sprite.alpha).toBe(0.25);
      expect(entity.isActive).toBe(false);
    });

    it("syncs an active entity in the same pass", () => {
      const { scene } = setup();

      const dormant = scene.spawn("dormant", { active: false });
      dormant.add(new Transform({ position: new Vec2(100, 200) }));
      const dormantSprite = dormant.add(
        new SpriteComponent({ texture: {} as never }),
      );
      const written = dormantSprite.sprite as unknown as InstanceType<
        typeof mocks.MockContainer
      >;
      written.position.set(10, 20);

      const overlay = spawnEntityInScene(scene, "overlay");
      overlay.add(new Transform({ position: new Vec2(30, 40) }));
      const overlayGfx = overlay.add(new GraphicsComponent());

      system.update();

      expect(written.position).toMatchObject({ x: 10, y: 20 });
      expect(
        (
          overlayGfx.graphics as unknown as InstanceType<
            typeof mocks.MockContainer
          >
        ).position,
      ).toMatchObject({ x: 30, y: 40 });
    });
  });
});

describe("DisplaySystem visual coverage", () => {
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

  function containerOf(visual: { renderObject: unknown }) {
    return visual.renderObject as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
  }

  it("syncs and modifies every visual an entity carries", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ position: new Vec2(100, 200) }));
    const background = entity.add(new GraphicsComponent());
    const label = entity.add(new TextComponent({ text: "hp" }));
    label.modifiers.addTransform({ position: new Vec2(0, -8) });

    system.update();

    expect(containerOf(background).position.x).toBe(100);
    expect(containerOf(background).position.y).toBe(200);
    expect(containerOf(label).position.x).toBe(100);
    expect(containerOf(label).position.y).toBe(192);
  });

  it("skips a visual whose entity has no Transform", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    const graphics = entity.add(new GraphicsComponent());

    system.update();

    expect(containerOf(graphics).position.x).toBe(0);
    expect(containerOf(graphics).position.y).toBe(0);
  });

  it("gates on effectiveEnabled, so a dormant entity is skipped", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ position: new Vec2(50, 60) }));
    const graphics = entity.add(new GraphicsComponent());
    entity.setActive(false);

    expect(graphics.enabled).toBe(true);
    expect(graphics.effectiveEnabled).toBe(false);

    system.update();

    expect(containerOf(graphics).position.x).toBe(0);
  });

  it("keeps modifier offsets out of the depth key", () => {
    const { scene, tree } = setup();
    tree.ensureLayer({ name: "ground", order: 0, sort: ySort });
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ position: new Vec2(0, 100) }));
    const graphics = entity.add(new GraphicsComponent({ layer: "ground" }));
    graphics.modifiers.addTransform({ position: new Vec2(0, 40) });

    system.update();

    expect(containerOf(graphics).zIndex).toBe(100);
    expect(containerOf(graphics).position.y).toBe(140);
  });

  it("syncs a VisualComponent subclass declared outside this package", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ position: new Vec2(7, 9) }));
    const probe = entity.add(new ProbeVisual());
    probe.modifiers.addTransform({ position: new Vec2(1, 2) });

    system.update();

    expect(containerOf(probe).position.x).toBe(8);
    expect(containerOf(probe).position.y).toBe(11);
  });

  it("skips innerSort for a disabled sort group", () => {
    const { scene, tree } = setup();
    tree.ensureLayer({ name: "ground", order: 0 });
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const group = entity.add(
      new SortGroupComponent({ layer: "ground", innerSort: () => 42 }),
    );
    const member = new mocks.MockContainer();
    group.container.addChild(member as never);
    group.enabled = false;

    system.update();

    expect(member.zIndex).toBe(0);

    group.enabled = true;
    system.update();
    expect(member.zIndex).toBe(42);
  });

  it("attributes a throwing depth-key function to the callback", () => {
    const { scene, tree, context } = setup();
    tree.ensureLayer({
      name: "ground",
      order: 0,
      sort: () => {
        throw new Error("bad depth key");
      },
    });
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    entity.add(new GraphicsComponent({ layer: "ground" }));

    expect(() => system.update()).toThrow("bad depth key");
    const boundary = context.resolve(ErrorBoundaryKey);
    expect(boundary.getCallbackErrors().at(-1)).toMatchObject({
      kind: "Layer depth-key function",
      event: "ground",
    });
  });

  it("attributes a throwing innerSort to the sort group's entity", () => {
    const { scene, tree, context } = setup();
    tree.ensureLayer({ name: "ground", order: 0 });
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform());
    const group = entity.add(
      new SortGroupComponent({
        layer: "ground",
        innerSort: () => {
          throw new Error("bad inner key");
        },
      }),
    );
    group.container.addChild(new mocks.MockContainer() as never);

    expect(() => system.update()).toThrow("bad inner key");
    const boundary = context.resolve(ErrorBoundaryKey);
    expect(boundary.getCallbackErrors().at(-1)).toMatchObject({
      kind: "Sort group innerSort function",
      entity: entity.name,
    });
  });
});
