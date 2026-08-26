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
    constructor(opts?: {
      source?: unknown;
      frame?: { width: number; height: number };
    }) {
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
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
  }
  return {
    Container: mocks.MockContainer,
    AnimatedSprite: mocks.MockAnimatedSprite,
    Texture: MockTexture,
    Rectangle: MockRectangle,
    Assets: { get: () => undefined },
  };
});

import { Transform } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import { AnimationController } from "./AnimationController.js";
import type { AnimationDef } from "./AnimationController.js";
import { LayeredAnimationController } from "./LayeredAnimationController.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

type Anim = "idle" | "attack";

// Frame counts are driven by the mock's fixed 96px-wide texture:
// floor(96 / frameWidth) frames. idle=3, attack(5-frame variant)=5,
// attack(10-frame variant)=10.
const IDLE_SOURCE = { sheet: "idle.png", frameWidth: 32 };
const ATTACK_SOURCE_5 = { sheet: "attack5.png", frameWidth: 19 };
const ATTACK_SOURCE_10 = { sheet: "attack10.png", frameWidth: 9 };

function makeLayer(
  scene: Scene,
  attackFrameCount: number,
): AnimationController<Anim> {
  const entity = spawnEntityInScene(scene);
  entity.add(new Transform());
  entity.add(new AnimatedSpriteComponent({ source: IDLE_SOURCE }));
  const anims: Record<Anim, AnimationDef> = {
    idle: { source: IDLE_SOURCE, speed: 0.2 },
    attack: {
      source: attackFrameCount === 5 ? ATTACK_SOURCE_5 : ATTACK_SOURCE_10,
      speed: 0.4,
      loop: false,
    },
  };
  return entity.add(new AnimationController<Anim>(anims));
}

describe("LayeredAnimationController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fans play() to every controller", () => {
    const { scene } = createRendererTestContext();
    const head = makeLayer(scene, 5);
    const body = makeLayer(scene, 5);
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [head, body] }),
    );

    layered.play("attack");

    expect(layered.current).toBe("attack");
    expect(head.current).toBe("attack");
    expect(body.current).toBe("attack");
  });

  it("playOneShot computes a single shared duration from the first controller and locks all layers in unison", () => {
    const { scene } = createRendererTestContext();
    const short = makeLayer(scene, 5); // 5 frames * (1/60) / 0.4 ≈ 0.208 s
    const long = makeLayer(scene, 10); // 10 frames * (1/60) / 0.4 ≈ 0.417 s
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [short, long] }),
    );

    layered.playOneShot("attack");
    const sharedDuration = short.calcDuration("attack");

    expect(layered.locked).toBe(true);
    expect(short.locked).toBe(true);
    expect(long.locked).toBe(true);

    // Tick just past the shorter controller's "natural" lock — both layers
    // should still be locked because they share the master timer.
    short.update!(0.1);
    long.update!(0.1);
    layered.update(0.1);
    expect(layered.locked).toBe(true);
    expect(short.locked).toBe(true);
    expect(long.locked).toBe(true);

    // Tick past the shared duration — all unlock together.
    const dt = sharedDuration - 0.1 + 0.001;
    short.update!(dt);
    long.update!(dt);
    layered.update(dt);
    expect(layered.locked).toBe(false);
    expect(short.locked).toBe(false);
    expect(long.locked).toBe(false);
  });

  it("children never auto-expire on their own ticks — only the master timer or unlock() releases them", () => {
    // The wrapper passes Number.POSITIVE_INFINITY as the per-child lock
    // duration so child controllers can never tick out independently. This
    // guarantees the master timer is the single source of truth even if
    // children and the wrapper land in different ticker groups or accumulate
    // a one-frame float drift.
    const { scene } = createRendererTestContext();
    const a = makeLayer(scene, 5);
    const b = makeLayer(scene, 5);
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [a, b] }),
    );

    layered.playOneShot("attack", { duration: 100 });
    // Tick the children far past what would naturally expire their own locks
    // (5 frames * (1/60) / 0.4 ≈ 0.208 s) without touching the master.
    a.update!(10_000);
    b.update!(10_000);
    expect(a.locked).toBe(true);
    expect(b.locked).toBe(true);
    expect(layered.locked).toBe(true);

    // Only when the wrapper's timer expires do the children release.
    layered.update(101);
    expect(layered.locked).toBe(false);
    expect(a.locked).toBe(false);
    expect(b.locked).toBe(false);
  });

  it("playOneShot accepts an explicit duration override", () => {
    const { scene } = createRendererTestContext();
    const a = makeLayer(scene, 5);
    const b = makeLayer(scene, 10);
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [a, b] }),
    );

    layered.playOneShot("attack", { duration: 50 });
    layered.update(25);
    expect(layered.locked).toBe(true);
    layered.update(26);
    expect(layered.locked).toBe(false);
  });

  it("rejects automatic timing when the first controller cannot produce a duration", () => {
    for (const speed of [0, -1]) {
      const { scene } = createRendererTestContext();
      const first = makeLayer(scene, 5);
      const second = makeLayer(scene, 10);
      first.speed = speed;
      const host = spawnEntityInScene(scene);
      const layered = host.add(
        new LayeredAnimationController<Anim>({
          controllers: [first, second],
        }),
      );

      expect(() => layered.playOneShot("attack")).toThrow(
        /positive effective speed/,
      );
      expect(layered.locked).toBe(false);
      expect(first.locked).toBe(false);
      expect(second.locked).toBe(false);
    }
  });

  it("allows a non-positive first-controller speed with an explicit duration", () => {
    const { scene } = createRendererTestContext();
    const first = makeLayer(scene, 5);
    const second = makeLayer(scene, 10);
    first.speed = -1;
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [first, second] }),
    );

    layered.playOneShot("attack", { duration: 1 });

    expect(layered.locked).toBe(true);
    expect(first.locked).toBe(true);
    expect(second.locked).toBe(true);
  });

  it("onComplete fires exactly once when the master lock expires", () => {
    const { scene } = createRendererTestContext();
    const a = makeLayer(scene, 5);
    const b = makeLayer(scene, 10);
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [a, b] }),
    );
    const cb = vi.fn();

    layered.playOneShot("attack", { duration: 100, onComplete: cb });
    layered.update(50);
    expect(cb).not.toHaveBeenCalled();
    layered.update(51);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("playOneShot is a no-op when already locked on the same animation", () => {
    const { scene } = createRendererTestContext();
    const a = makeLayer(scene, 5);
    const b = makeLayer(scene, 5);
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [a, b] }),
    );
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    layered.playOneShot("attack", { duration: 200, onComplete: cb1 });
    layered.update(50);
    layered.playOneShot("attack", { duration: 200, onComplete: cb2 });
    layered.update(151);
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).not.toHaveBeenCalled();
  });

  it("forcePlay clears the lock on every layer", () => {
    const { scene } = createRendererTestContext();
    const a = makeLayer(scene, 5);
    const b = makeLayer(scene, 5);
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [a, b] }),
    );

    layered.playOneShot("attack", { duration: 1000 });
    layered.forcePlay("idle");

    expect(layered.locked).toBe(false);
    expect(layered.current).toBe("idle");
    expect(a.current).toBe("idle");
    expect(b.current).toBe("idle");
    expect(a.locked).toBe(false);
    expect(b.locked).toBe(false);
  });

  it("throws when constructed with no controllers", () => {
    expect(
      () => new LayeredAnimationController({ controllers: [] }),
    ).toThrow(/at least one controller/);
  });
});
