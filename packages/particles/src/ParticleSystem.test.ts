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
    parent: unknown = null;
    destroyed = false;
    constructor(_opts?: unknown) {}
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

import { Transform, Vec2, Phase } from "@yage/core";
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

  it("has phase = Update", () => {
    expect(system.phase).toBe(Phase.Update);
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
    system.update(100); // 100ms → 0.1s

    expect(spy).toHaveBeenCalledWith(0.1, 50, 75);
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

    system.update(50);

    expect(spy1).toHaveBeenCalledWith(0.05, 10, 20);
    expect(spy2).toHaveBeenCalledWith(0.05, 30, 40);
  });
});
