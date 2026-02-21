import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0 };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;
    tint = 0xffffff;
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
    clear(): MockGraphics { return this; }
    rect(): MockGraphics { return this; }
    circle(): MockGraphics { return this; }
    fill(): MockGraphics { return this; }
    stroke(): MockGraphics { return this; }
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
    play(): void { this.playing = true; }
    stop(): void { this.playing = false; }
  }

  return { mocks: { MockContainer, MockSprite, MockGraphics, MockAnimatedSprite } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
  Graphics: mocks.MockGraphics,
  AnimatedSprite: mocks.MockAnimatedSprite,
}));

import { Transform, Vec2 } from "@yage/core";
import { DisplaySystem } from "./DisplaySystem.js";
import { SpriteComponent } from "./SpriteComponent.js";
import { GraphicsComponent } from "./GraphicsComponent.js";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import { createRendererTestContext, spawnEntityInScene } from "./test-helpers.js";

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
    const transform = entity.add(new Transform({ position: new Vec2(100, 200) }));
    const spriteComp = entity.add(new SpriteComponent({ texture: {} as never }));

    system.update(16);

    const sprite = spriteComp.sprite as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(sprite.position.x).toBe(transform.position.x);
    expect(sprite.position.y).toBe(transform.position.y);
  });

  it("syncs Transform rotation to sprite display object", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ rotation: 1.5 }));
    const spriteComp = entity.add(new SpriteComponent({ texture: {} as never }));

    system.update(16);

    const sprite = spriteComp.sprite as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(sprite.rotation).toBe(1.5);
  });

  it("syncs Transform scale to sprite display object", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ scale: new Vec2(2, 3) }));
    const spriteComp = entity.add(new SpriteComponent({ texture: {} as never }));

    system.update(16);

    const sprite = spriteComp.sprite as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(sprite.scale.x).toBe(2);
    expect(sprite.scale.y).toBe(3);
  });

  it("syncs Transform to graphics display object", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ position: new Vec2(50, 75) }));
    const gfxComp = entity.add(new GraphicsComponent());

    system.update(16);

    const gfx = gfxComp.graphics as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(gfx.position.x).toBe(50);
    expect(gfx.position.y).toBe(75);
  });

  it("syncs Transform to animated sprite display object", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ position: new Vec2(30, 40) }));
    const animComp = entity.add(new AnimatedSpriteComponent({ textures: [{} as never] }));

    system.update(16);

    const anim = animComp.animatedSprite as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(anim.position.x).toBe(30);
    expect(anim.position.y).toBe(40);
  });

  it("skips disabled components", () => {
    const { scene } = setup();
    const entity = spawnEntityInScene(scene);
    entity.add(new Transform({ position: new Vec2(100, 200) }));
    const spriteComp = entity.add(new SpriteComponent({ texture: {} as never }));
    spriteComp.enabled = false;

    system.update(16);

    const sprite = spriteComp.sprite as unknown as InstanceType<typeof mocks.MockContainer>;
    // Position should remain at default (0, 0) since sync was skipped
    expect(sprite.position.x).toBe(0);
    expect(sprite.position.y).toBe(0);
  });

  it("applies camera transform to stage container", () => {
    const { stage, camera } = setup();
    camera.position = new Vec2(100, 50);
    camera.zoom = 2;

    system.update(16);

    // stage.position = viewport/2 - camera.effectivePosition * zoom
    // x: 800/2 - 100*2 = 400 - 200 = 200
    // y: 600/2 - 50*2 = 300 - 100 = 200
    expect(stage.position.x).toBe(200);
    expect(stage.position.y).toBe(200);
    expect(stage.scale.x).toBe(2);
    expect(stage.scale.y).toBe(2);
  });

  it("applies camera rotation (inverted) to stage", () => {
    const { stage, camera } = setup();
    camera.rotation = 0.5;

    system.update(16);

    expect(stage.rotation).toBe(-0.5);
  });

  it("updates camera state before syncing", () => {
    const { camera } = setup();
    const target = { position: new Vec2(200, 100) };
    camera.follow(target);

    // Camera starts at 0,0, after update it should snap to target
    system.update(16);

    expect(camera.position.x).toBeCloseTo(200);
    expect(camera.position.y).toBeCloseTo(100);
  });

  it("handles multiple entities", () => {
    const { scene } = setup();

    const e1 = spawnEntityInScene(scene, "e1");
    e1.add(new Transform({ position: new Vec2(10, 20) }));
    const s1 = e1.add(new SpriteComponent({ texture: {} as never }));

    const e2 = spawnEntityInScene(scene, "e2");
    e2.add(new Transform({ position: new Vec2(30, 40) }));
    const s2 = e2.add(new SpriteComponent({ texture: {} as never }));

    system.update(16);

    expect((s1.sprite as unknown as InstanceType<typeof mocks.MockContainer>).position.x).toBe(10);
    expect((s2.sprite as unknown as InstanceType<typeof mocks.MockContainer>).position.x).toBe(30);
  });
});
