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

  it("leaves screen-space layers at identity under a default camera", () => {
    const { scene, tree } = setup();
    tree.ensureLayer({ name: "world", order: 0 });
    tree.ensureLayer({ name: "ui", order: 1000, screenSpace: true });

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
    // UI stays identity
    expect(ui.scale.x).toBe(1);
    expect(ui.position.x).toBe(0);
    expect(ui.position.y).toBe(0);
    expect(ui.rotation).toBe(0);
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
