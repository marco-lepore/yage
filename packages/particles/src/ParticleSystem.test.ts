import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockParticle {
    x = 0;
    y = 0;
    scaleX = 1;
    scaleY = 1;
    rotation = 0;
    alpha = 1;
    texture: unknown;
    _tint = 0xffffff;
    color = 0xffffffff;
    constructor(t: unknown) { this.texture = t; }
    get tint(): number { return this._tint; }
    set tint(v: number) { this._tint = v; }
  }

  class MockParticleContainer {
    children: unknown[] = [];
    position = {
      x: 0,
      y: 0,
      set(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    parent: unknown = null;
    destroyed = false;
    addParticle(p: unknown): unknown { this.children.push(p); return p; }
    removeParticle(p: unknown): unknown {
      const idx = this.children.indexOf(p);
      if (idx !== -1) this.children.splice(idx, 1);
      return p;
    }
    removeFromParent(): void {}
    destroy(): void { this.destroyed = true; }
  }

  class MockContainer {
    children: unknown[] = [];
    position = { x: 0, y: 0 };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    parent: unknown = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;
    addChild(child: unknown): unknown {
      this.children.push(child);
      if (child && typeof child === "object") (child as Record<string, unknown>).parent = this;
      return child;
    }
    removeChild(child: unknown): unknown {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      return child;
    }
    removeFromParent(): void {}
    sortChildren(): void {}
    destroy(): void { this.destroyed = true; }
  }

  return { mocks: { MockParticle, MockParticleContainer, MockContainer } };
});

vi.mock("pixi.js", () => ({
  Particle: mocks.MockParticle,
  ParticleContainer: mocks.MockParticleContainer,
  Container: mocks.MockContainer,
}));

import { Transform, Vec2, Phase, SceneTime, SceneTimeKey } from "@yagejs/core";
import { createParticlesTestContext, spawnEntityInScene } from "./test-helpers.js";
import { ParticleSystem } from "./ParticleSystem.js";
import { ParticleEmitterComponent } from "./ParticleEmitterComponent.js";

const tex = { label: "test" } as never;

describe("ParticleSystem", () => {
  let system: ParticleSystem;

  beforeEach(() => {
    system = new ParticleSystem();
  });

  function setup() {
    const ctx = createParticlesTestContext();
    system._setContext(ctx.context);
    system.onRegister?.(ctx.context);
    return ctx;
  }

  it("has phase = LateUpdate", () => {
    // After every component update, so an emitter reads the frame's final
    // Transform instead of the previous frame's.
    expect(system.phase).toBe(Phase.LateUpdate);
  });

  it("positions an emitter's container from its entity's Transform", () => {
    const ctx = setup();
    const entity = spawnEntityInScene(ctx.scene);
    entity.add(new Transform({ position: new Vec2(120, 340) }));
    const emitter = entity.add(
      new ParticleEmitterComponent({ texture: tex, lifetime: 1 }),
    );

    system.update(0.1);

    expect(emitter.container.position.x).toBe(120);
    expect(emitter.container.position.y).toBe(340);
  });

  it("registers a query for [Transform, ParticleEmitterComponent]", () => {
    const ctx = setup();
    // Spawn an entity with both components — the system should see it
    const entity = spawnEntityInScene(ctx.scene);
    entity.add(new Transform());
    entity.add(new ParticleEmitterComponent({ texture: tex, lifetime: 1 }));

    // No error when updating
    system.update(16);
  });

  it("calls _update on emitter with dt in seconds and entity position", () => {
    const ctx = setup();
    const entity = spawnEntityInScene(ctx.scene);
    entity.add(new Transform({ position: new Vec2(50, 75) }));
    const emitter = entity.add(
      new ParticleEmitterComponent({ texture: tex, lifetime: 1, rate: 100 }),
    );
    emitter.emit();

    const spy = vi.spyOn(emitter, "_update");
    system.update(0.1); // dt is in seconds

    expect(spy).toHaveBeenCalledWith(0.1, 50, 75);
  });

  it("uses the world position of a parented emitter, not its local one", () => {
    const ctx = setup();
    const parent = spawnEntityInScene(ctx.scene, "parent");
    parent.add(new Transform({ position: new Vec2(100, 200) }));

    const child = spawnEntityInScene(ctx.scene, "child");
    child.add(new Transform({ position: new Vec2(5, 7) }));
    const emitter = child.add(
      new ParticleEmitterComponent({ texture: tex, lifetime: 1, rate: 100 }),
    );
    parent.addChild("muzzle", child);
    emitter.emit();

    const spy = vi.spyOn(emitter, "_update");
    system.update(0.1);

    expect(spy).toHaveBeenCalledWith(0.1, 105, 207);
  });

  it("skips disabled emitters", () => {
    const ctx = setup();
    const entity = spawnEntityInScene(ctx.scene);
    entity.add(new Transform());
    const emitter = entity.add(
      new ParticleEmitterComponent({ texture: tex, lifetime: 1, rate: 100 }),
    );
    emitter.enabled = false;
    emitter.emit();

    const spy = vi.spyOn(emitter, "_update");
    system.update(100);

    expect(spy).not.toHaveBeenCalled();
  });

  it("handles multiple entities", () => {
    const ctx = setup();

    const e1 = spawnEntityInScene(ctx.scene, "e1");
    e1.add(new Transform({ position: new Vec2(10, 20) }));
    const em1 = e1.add(new ParticleEmitterComponent({ texture: tex, lifetime: 1 }));

    const e2 = spawnEntityInScene(ctx.scene, "e2");
    e2.add(new Transform({ position: new Vec2(30, 40) }));
    const em2 = e2.add(new ParticleEmitterComponent({ texture: tex, lifetime: 1 }));

    const spy1 = vi.spyOn(em1, "_update");
    const spy2 = vi.spyOn(em2, "_update");

    system.update(0.05);

    expect(spy1).toHaveBeenCalledWith(0.05, 10, 20);
    expect(spy2).toHaveBeenCalledWith(0.05, 30, 40);
  });

  it("applies SceneTime per-entity scale, honoring excludeUpdates", () => {
    const ctx = setup();
    const time = new SceneTime(ctx.scene);
    ctx.scene.registerScoped(SceneTimeKey, time);

    const excluded = spawnEntityInScene(ctx.scene, "excluded");
    excluded.add(new Transform());
    const excludedEmitter = excluded.add(
      new ParticleEmitterComponent({ texture: tex, lifetime: 1 }),
    );

    const other = spawnEntityInScene(ctx.scene, "other");
    other.add(new Transform());
    const otherEmitter = other.add(
      new ParticleEmitterComponent({ texture: tex, lifetime: 1 }),
    );
    other.timeScale = 2; // entity.timeScale composes on top

    time.scaleBy(0.5, { key: "slowmo", excludeUpdates: [excluded] });

    const excludedSpy = vi.spyOn(excludedEmitter, "_update");
    const otherSpy = vi.spyOn(otherEmitter, "_update");
    system.update(0.1);

    expect(excludedSpy).toHaveBeenCalledWith(0.1, 0, 0);
    expect(otherSpy).toHaveBeenCalledWith(0.1 * 0.5 * 2, 0, 0);
  });

  it("applies target-scoped SceneTime requests", () => {
    const ctx = setup();
    const time = new SceneTime(ctx.scene);
    ctx.scene.registerScoped(SceneTimeKey, time);

    const target = spawnEntityInScene(ctx.scene, "target");
    target.add(new Transform());
    const targetEmitter = target.add(
      new ParticleEmitterComponent({ texture: tex, lifetime: 1 }),
    );
    const other = spawnEntityInScene(ctx.scene, "other");
    other.add(new Transform());
    const otherEmitter = other.add(
      new ParticleEmitterComponent({ texture: tex, lifetime: 1 }),
    );
    time.scaleEntityBy(target, 0.25);

    const targetSpy = vi.spyOn(targetEmitter, "_update");
    const otherSpy = vi.spyOn(otherEmitter, "_update");
    system.update(0.1);

    expect(targetSpy).toHaveBeenCalledWith(0.025, 0, 0);
    expect(otherSpy).toHaveBeenCalledWith(0.1, 0, 0);
  });
});
