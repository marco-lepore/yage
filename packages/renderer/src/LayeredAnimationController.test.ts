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

    // The lead controller owns the shared timer.
    short.update!(0.1);
    long.update!(0.1);
    expect(layered.locked).toBe(true);
    expect(short.locked).toBe(true);
    expect(long.locked).toBe(true);

    // Tick past the shared duration — all unlock together.
    const dt = sharedDuration - 0.1 + 0.001;
    short.update!(dt);
    expect(layered.locked).toBe(false);
    expect(short.locked).toBe(false);
    expect(long.locked).toBe(false);
  });

  it("non-lead children stay locked until the lead timer completes", () => {
    const { scene } = createRendererTestContext();
    const a = makeLayer(scene, 5);
    const b = makeLayer(scene, 5);
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [a, b] }),
    );

    layered.playOneShot("attack", { duration: 100 });
    // A non-lead controller has an infinite lock duration.
    b.update!(10_000);
    expect(a.locked).toBe(true);
    expect(b.locked).toBe(true);
    expect(layered.locked).toBe(true);

    // The lead controller releases the whole group.
    a.update!(101);
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
    a.update!(25);
    expect(layered.locked).toBe(true);
    a.update!(26);
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

  it("retimes automatic completion when the lead speed changes", () => {
    for (const speed of [0.5, 2]) {
      const { scene } = createRendererTestContext();
      const first = makeLayer(scene, 5);
      const second = makeLayer(scene, 5);
      const host = spawnEntityInScene(scene);
      const layered = host.add(
        new LayeredAnimationController<Anim>({
          controllers: [first, second],
        }),
      );
      const initialDuration = first.calcDuration("attack");

      layered.playOneShot("attack");
      first.update!(initialDuration * 0.4);
      first.speed = speed;
      const updatedDuration = first.calcDuration("attack");

      expect(second.speed).toBe(speed);
      first.update!(updatedDuration * 0.59);
      expect(layered.locked).toBe(true);
      first.update!(updatedDuration * 0.02);
      expect(layered.locked).toBe(false);
      expect(second.locked).toBe(false);
    }
  });

  it("writes layered speed to every controller", () => {
    const { scene } = createRendererTestContext();
    const first = makeLayer(scene, 5);
    const second = makeLayer(scene, 10);
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [first, second] }),
    );

    layered.speed = 1.5;

    expect(layered.speed).toBe(1.5);
    expect(first.speed).toBe(1.5);
    expect(second.speed).toBe(1.5);

    second.speed = 0.75;
    expect(layered.speed).toBe(0.75);
    expect(first.speed).toBe(0.75);
    expect(second.speed).toBe(0.75);
  });

  it("rejects an invalid speed change from any layer without changing the group", () => {
    const { scene } = createRendererTestContext();
    const first = makeLayer(scene, 5);
    const second = makeLayer(scene, 10);
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [first, second] }),
    );
    layered.playOneShot("attack");

    expect(() => (second.speed = 0)).toThrow(/positive effective speed/);
    expect(layered.speed).toBe(1);
    expect(first.speed).toBe(1);
    expect(second.speed).toBe(1);
    expect(layered.locked).toBe(true);
  });

  it("releases shared speed ownership when removed", () => {
    const { scene } = createRendererTestContext();
    const first = makeLayer(scene, 5);
    const second = makeLayer(scene, 10);
    const host = spawnEntityInScene(scene);
    host.add(
      new LayeredAnimationController<Anim>({ controllers: [first, second] }),
    );

    host.remove(LayeredAnimationController);
    second.speed = 2;

    expect(first.speed).toBe(1);
    expect(second.speed).toBe(2);
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
    a.update!(50);
    expect(cb).not.toHaveBeenCalled();
    a.update!(51);
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
    a.update!(50);
    layered.playOneShot("attack", { duration: 200, onComplete: cb2 });
    a.update!(151);
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

  it("throws naming the layer when one layer lacks the animation, leaving every layer untouched", () => {
    const { scene } = createRendererTestContext();
    const full = makeLayer(scene, 5);
    const partialEntity = spawnEntityInScene(scene);
    partialEntity.add(new Transform());
    partialEntity.add(new AnimatedSpriteComponent({ source: IDLE_SOURCE }));
    const partial = partialEntity.add(
      new AnimationController<Anim>({
        idle: { source: IDLE_SOURCE, speed: 0.2 },
      } as Record<Anim, AnimationDef>),
    );
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [full, partial] }),
    );

    for (const call of [
      () => layered.play("attack"),
      () => layered.playOneShot("attack"),
      () => layered.forcePlay("attack"),
    ]) {
      expect(call).toThrow(
        /layer 1 has no animation "attack"; every layer must define it/,
      );
      expect(layered.current).toBe("");
      expect(full.current).toBe("idle");
      expect(partial.current).toBe("idle");
    }
  });

  it("throws before any layer switches when a startFrame is out of range for a shorter layer", () => {
    const { scene } = createRendererTestContext();
    const long = makeLayer(scene, 10);
    const short = makeLayer(scene, 5);
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [long, short] }),
    );

    // Frame 7 exists in the 10-frame leader but not in the 5-frame layer.
    expect(() => layered.playOneShot("attack", { startFrame: 7 })).toThrow(
      /startFrame 7 is out of range \(0-4\)/,
    );
    expect(layered.current).toBe("");
    expect(layered.locked).toBe(false);
    expect(long.current).toBe("idle");
    expect(long.locked).toBe(false);
    expect(short.current).toBe("idle");
  });

  it("leaves the wrapper unlocked when an explicit-duration play is rejected", () => {
    const { scene } = createRendererTestContext();
    const a = makeLayer(scene, 5);
    const b = makeLayer(scene, 5);
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [a, b] }),
    );

    expect(() =>
      layered.playOneShot("attack", { duration: 1, startFrame: 99 }),
    ).toThrow(/startFrame 99 is out of range/);
    // A wrapper left locked here would wait forever: no layer holds a timer
    // that can complete it, so every later play() would be a no-op.
    expect(layered.locked).toBe(false);
    expect(layered.current).toBe("");
    layered.play("attack");
    expect(layered.current).toBe("attack");
    expect(a.current).toBe("attack");
    expect(b.current).toBe("attack");
  });

  it("fires its own onCancel on re-arm and on unlock, and hands none to the layers", () => {
    const { scene } = createRendererTestContext();
    const a = makeLayer(scene, 5);
    const b = makeLayer(scene, 5);
    const aPlay = vi.spyOn(a, "playOneShot");
    const bPlay = vi.spyOn(b, "playOneShot");
    const host = spawnEntityInScene(scene);
    const layered = host.add(
      new LayeredAnimationController<Anim>({ controllers: [a, b] }),
    );

    const rearmed = vi.fn();
    layered.playOneShot("attack", { duration: 1000, onCancel: rearmed });
    // The wrapper unlocks its layers as bookkeeping, so a layer must never
    // hold the game's cancel callback.
    for (const spy of [aPlay, bPlay]) {
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]?.[1]).not.toHaveProperty("onCancel");
    }

    layered.playOneShot("idle", { duration: 1000 });
    expect(rearmed).toHaveBeenCalledOnce();

    const released = vi.fn();
    layered.playOneShot("attack", { duration: 1000, onCancel: released });
    layered.unlock();
    expect(released).toHaveBeenCalledOnce();
    expect(rearmed).toHaveBeenCalledOnce();
  });
});
