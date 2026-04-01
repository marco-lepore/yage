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

  class MockAnchor {
    x = 0.5;
    y = 0.5;
    set(x: number, y: number): void {
      this.x = x;
      this.y = y;
    }
  }

  class MockAnimatedSprite extends MockContainer {
    textures: unknown[];
    animationSpeed = 1;
    loop = true;
    playing = false;
    currentFrame = 0;
    anchor = new MockAnchor();
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

    gotoAndPlay(frame: number): void {
      this.currentFrame = frame;
      this.playing = true;
    }
  }

  return { mocks: { MockContainer, MockAnimatedSprite } };
});

vi.mock("pixi.js", () => {
  class MockTexture {
    source = { scaleMode: "nearest" };
    width: number;
    height: number;
    constructor(opts?: { source?: unknown; frame?: { width: number; height: number } }) {
      this.width = opts?.frame?.width ?? 96;
      this.height = opts?.frame?.height ?? 48;
    }
    static from(key: string): MockTexture {
      const t = new MockTexture();
      (t as unknown as Record<string, unknown>).label = key;
      t.width = 96;
      t.height = 48;
      return t;
    }
  }
  class MockRectangle {
    constructor(public x: number, public y: number, public width: number, public height: number) {}
  }
  return {
    Container: mocks.MockContainer,
    AnimatedSprite: mocks.MockAnimatedSprite,
    Texture: MockTexture,
    Rectangle: MockRectangle,
    Assets: { get: () => undefined },
  };
});

import { Transform } from "@yage/core";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import { AnimationController } from "./AnimationController.js";
import type { AnimationDef } from "./AnimationController.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

type TestAnim = "idle" | "walk" | "shoot";

function makeFrames(n: number): never[] {
  return Array.from({ length: n }, (_, i) => ({ label: `frame${i}` })) as never[];
}

const idleFrames = makeFrames(4);
const walkFrames = makeFrames(6);
const shootFrames = makeFrames(3);

function testAnims(): Record<TestAnim, AnimationDef> {
  return {
    idle: { frames: idleFrames as never, speed: 0.15 },
    walk: { frames: walkFrames as never, speed: 0.2 },
    shoot: { frames: shootFrames as never, speed: 0.4, loop: false },
  };
}

type MockSprite = InstanceType<typeof mocks.MockAnimatedSprite>;

function setup(anims?: Record<TestAnim, AnimationDef>) {
  const { scene } = createRendererTestContext();
  const entity = spawnEntityInScene(scene);
  entity.add(new Transform());
  const spriteComp = entity.add(
    new AnimatedSpriteComponent({ textures: idleFrames as never }),
  );
  const ctrl = entity.add(
    new AnimationController<TestAnim>(anims ?? testAnims()),
  );
  const sprite = spriteComp.animatedSprite as unknown as MockSprite;
  return { entity, ctrl, sprite, spriteComp };
}

describe("AnimationController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-plays first animation on add", () => {
    const { ctrl, sprite } = setup();
    expect(ctrl.current).toBe("idle");
    expect(sprite.textures).toBe(idleFrames);
    expect(sprite.animationSpeed).toBe(0.15);
    expect(sprite.loop).toBe(true);
    expect(sprite.playing).toBe(true);
  });

  it("play() switches animation", () => {
    const { ctrl, sprite } = setup();
    ctrl.play("walk");
    expect(ctrl.current).toBe("walk");
    expect(sprite.textures).toBe(walkFrames);
    expect(sprite.animationSpeed).toBe(0.2);
    expect(sprite.loop).toBe(true);
  });

  it("play() is a no-op if same animation", () => {
    const { ctrl, sprite } = setup();
    // Switch to walk first, then verify idle → idle skips
    ctrl.play("walk");
    sprite.currentFrame = 3; // simulate mid-anim
    ctrl.play("walk");
    expect(sprite.currentFrame).toBe(3); // not reset to 0
  });

  it("play() is a no-op when locked", () => {
    const { ctrl } = setup();
    ctrl.playOneShot("shoot");
    ctrl.play("walk");
    expect(ctrl.current).toBe("shoot");
    expect(ctrl.locked).toBe(true);
  });

  it("playOneShot() locks and auto-calculates duration", () => {
    const { ctrl } = setup();
    ctrl.playOneShot("shoot");
    expect(ctrl.current).toBe("shoot");
    expect(ctrl.locked).toBe(true);

    const expectedDuration = (3 * (1000 / 60)) / 0.4;
    // Just before expiry
    ctrl.update!(expectedDuration - 1);
    expect(ctrl.locked).toBe(true);
    // Past expiry
    ctrl.update!(2);
    expect(ctrl.locked).toBe(false);
  });

  it("playOneShot() uses custom duration", () => {
    const { ctrl } = setup();
    ctrl.playOneShot("shoot", { duration: 200 });
    expect(ctrl.locked).toBe(true);
    ctrl.update!(100);
    expect(ctrl.locked).toBe(true);
    ctrl.update!(101);
    expect(ctrl.locked).toBe(false);
  });

  it("playOneShot() calls onComplete when lock expires", () => {
    const cb = vi.fn();
    const { ctrl } = setup();
    ctrl.playOneShot("shoot", { duration: 100, onComplete: cb });
    ctrl.update!(50);
    expect(cb).not.toHaveBeenCalled();
    ctrl.update!(51);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("playOneShot() is a no-op if already locked on the same animation", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { ctrl, sprite } = setup();
    ctrl.playOneShot("shoot", { duration: 200, onComplete: cb1 });
    ctrl.update!(50);
    sprite.currentFrame = 2; // simulate mid-animation
    ctrl.playOneShot("shoot", { duration: 200, onComplete: cb2 });
    // Should not have restarted — frame preserved, original callback kept
    expect(sprite.currentFrame).toBe(2);
    ctrl.update!(151); // 50 + 151 = 201 > 200 → original timer expires
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).not.toHaveBeenCalled();
  });

  it("playOneShot() overrides a different locked animation", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { ctrl } = setup();
    ctrl.playOneShot("shoot", { duration: 200, onComplete: cb1 });
    ctrl.update!(50);
    ctrl.playOneShot("walk", { duration: 100, onComplete: cb2 });
    expect(ctrl.current).toBe("walk");
    ctrl.update!(101); // new timer expires
    expect(cb2).toHaveBeenCalledOnce();
    expect(cb1).not.toHaveBeenCalled(); // old callback discarded
  });

  it("playOneShot() always sets loop to false", () => {
    const { ctrl, sprite } = setup();
    // idle has loop: true (default), but one-shot should override
    ctrl.playOneShot("idle", { duration: 100 });
    expect(sprite.loop).toBe(false);
  });

  it("forcePlay() clears lock and applies", () => {
    const { ctrl } = setup();
    ctrl.playOneShot("shoot", { duration: 1000 });
    expect(ctrl.locked).toBe(true);
    ctrl.forcePlay("idle");
    expect(ctrl.locked).toBe(false);
    expect(ctrl.current).toBe("idle");
  });

  it("forcePlay() discards pending onComplete", () => {
    const cb = vi.fn();
    const { ctrl } = setup();
    ctrl.playOneShot("shoot", { duration: 100, onComplete: cb });
    ctrl.forcePlay("idle");
    ctrl.update!(200);
    expect(cb).not.toHaveBeenCalled();
  });

  it("unlock() releases the lock", () => {
    const { ctrl } = setup();
    ctrl.playOneShot("shoot", { duration: 1000 });
    ctrl.unlock();
    expect(ctrl.locked).toBe(false);
    // play() now works
    ctrl.play("walk");
    expect(ctrl.current).toBe("walk");
  });

  it("calcDuration() computes wall-clock ms", () => {
    const { ctrl } = setup();
    // shoot: 3 frames, speed 0.4, global speed 1
    const expected = (3 * (1000 / 60)) / (0.4 * 1);
    expect(ctrl.calcDuration("shoot")).toBeCloseTo(expected);
  });

  it("calcDuration() accounts for speed multiplier", () => {
    const { ctrl } = setup();
    ctrl.speed = 2;
    const expected = (3 * (1000 / 60)) / (0.4 * 2);
    expect(ctrl.calcDuration("shoot")).toBeCloseTo(expected);
  });

  it("inFrameRange() checks current frame", () => {
    const { ctrl, sprite } = setup();
    sprite.currentFrame = 5;
    expect(ctrl.inFrameRange(3, 7)).toBe(true);
    expect(ctrl.inFrameRange(6, 8)).toBe(false);
    expect(ctrl.inFrameRange(5, 5)).toBe(true);
  });

  it("per-animation anchor is applied", () => {
    const anims = testAnims();
    anims.walk.anchor = { x: 0.3, y: 0.7 };
    const { ctrl, sprite } = setup(anims);
    ctrl.play("walk");
    expect(sprite.anchor.x).toBe(0.3);
    expect(sprite.anchor.y).toBe(0.7);
  });

  it("anchor is not changed when not specified in def", () => {
    const { ctrl, sprite } = setup();
    sprite.anchor.set(0.25, 0.75);
    ctrl.play("walk"); // walk has no anchor defined
    expect(sprite.anchor.x).toBe(0.25);
    expect(sprite.anchor.y).toBe(0.75);
  });

  it("speed multiplier affects animation speed", () => {
    const { ctrl, sprite } = setup();
    ctrl.speed = 2;
    ctrl.play("walk");
    expect(sprite.animationSpeed).toBe(0.2 * 2);
  });

  it("update() is a no-op when not locked", () => {
    const { ctrl } = setup();
    // Should not throw or change state
    ctrl.update!(16);
    expect(ctrl.locked).toBe(false);
    expect(ctrl.current).toBe("idle");
  });

  describe("serialization", () => {
    it("serialize returns null when defs use raw frames", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { ctrl } = setup();
      expect(ctrl.serialize()).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it("serialize returns data when all defs use source", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      entity.add(new AnimatedSpriteComponent({ source: { sheet: "idle.png", frameWidth: 48 } }));
      const ctrl = entity.add(
        new AnimationController({
          idle: { source: { sheet: "idle.png", frameWidth: 48 }, speed: 0.15 },
          walk: { source: { sheet: "walk.png", frameWidth: 48 }, speed: 0.2, loop: true },
        }),
      );

      const data = ctrl.serialize()!;
      expect(data).not.toBeNull();
      expect(data.current).toBe("idle");
      expect(data.speed).toBe(1);
      expect(data.animations["idle"]!.source).toEqual({ sheet: "idle.png", frameWidth: 48 });
      expect(data.animations["walk"]!.source).toEqual({ sheet: "walk.png", frameWidth: 48 });
      expect(data.animations["walk"]!.loop).toBe(true);
    });

    it("fromSnapshot round-trips current animation and speed", () => {
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      entity.add(new AnimatedSpriteComponent({ source: { sheet: "idle.png", frameWidth: 48 } }));
      const ctrl = entity.add(
        new AnimationController({
          idle: { source: { sheet: "idle.png", frameWidth: 48 }, speed: 0.15 },
          walk: { source: { sheet: "walk.png", frameWidth: 48 }, speed: 0.2 },
        }),
      );
      ctrl.play("walk");
      ctrl.speed = 1.5;

      const data = ctrl.serialize()!;
      expect(data.current).toBe("walk");
      expect(data.speed).toBe(1.5);

      // Restore in a new entity
      const entity2 = spawnEntityInScene(scene);
      entity2.add(new Transform());
      entity2.add(new AnimatedSpriteComponent({ source: { sheet: "idle.png", frameWidth: 48 } }));
      const restored = entity2.add(AnimationController.fromSnapshot(data));
      expect(restored.current).toBe("walk");
      expect(restored.speed).toBe(1.5);
    });

    it("mixed source/frames marks controller as not serializable", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { scene } = createRendererTestContext();
      const entity = spawnEntityInScene(scene);
      entity.add(new Transform());
      entity.add(new AnimatedSpriteComponent({ textures: makeFrames(2) as never[] }));
      const ctrl = entity.add(
        new AnimationController({
          idle: { source: { sheet: "idle.png", frameWidth: 48 }, speed: 0.15 },
          walk: { frames: makeFrames(4) as never[], speed: 0.2 },
        }),
      );
      expect(ctrl.serialize()).toBeNull();
      warnSpy.mockRestore();
    });

    it("throws when AnimationDef has neither source nor frames", () => {
      expect(
        () => new AnimationController({ idle: { speed: 0.15 } as never }),
      ).toThrow(/requires either/);
    });
  });
});
