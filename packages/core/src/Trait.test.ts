import { describe, it, expect, expectTypeOf, beforeEach } from "vitest";
import { defineTrait, trait, TraitToken } from "./Trait.js";
import { Entity, _resetEntityIdCounter } from "./Entity.js";

beforeEach(() => {
  _resetEntityIdCounter();
});

// ---- Test traits ----

const Interactable = defineTrait<{ interact(): void; priority: number }>(
  "Interactable",
);

const Damageable = defineTrait<{
  damage(amount: number): void;
  health: number;
}>("Damageable");

describe("defineTrait", () => {
  it("creates token with correct name", () => {
    expect(Interactable).toBeInstanceOf(TraitToken);
    expect(Interactable.name).toBe("Interactable");
    expect(typeof Interactable.symbol).toBe("symbol");
  });

  it("each token has a unique symbol", () => {
    const a = defineTrait("A");
    const b = defineTrait("B");
    expect(a.symbol).not.toBe(b.symbol);
  });
});

describe("@trait — single trait", () => {
  @trait(Interactable)
  class Light extends Entity {
    priority = 4;
    interact() {
      /* toggle */
    }
  }

  it("hasTrait returns true for the registered trait", () => {
    const e = new Light();
    expect(e.hasTrait(Interactable)).toBe(true);
  });

  it("hasTrait returns false for an unregistered trait", () => {
    const e = new Light();
    expect(e.hasTrait(Damageable)).toBe(false);
  });

  it("entity is instanceof Entity", () => {
    const e = new Light();
    expect(e).toBeInstanceOf(Entity);
  });

  it("trait members are accessible", () => {
    const e = new Light();
    expect(e.priority).toBe(4);
    expect(typeof e.interact).toBe("function");
  });
});

describe("@trait — multiple traits", () => {
  @trait(Interactable)
  @trait(Damageable)
  class Enemy extends Entity {
    priority = 2;
    interact() {
      /* talk */
    }
    health = 10;
    damage(amount: number) {
      this.health -= amount;
      /* ouch */
    }
  }

  it("both traits are discoverable", () => {
    const e = new Enemy();
    expect(e.hasTrait(Interactable)).toBe(true);
    expect(e.hasTrait(Damageable)).toBe(true);
  });
});

describe("hasTrait type narrowing", () => {
  @trait(Interactable)
  class Lamp extends Entity {
    priority = 1;
    interact() {}
  }

  it("narrows type after hasTrait check", () => {
    const entity: Entity = new Lamp();

    if (entity.hasTrait(Interactable)) {
      expectTypeOf(entity).toHaveProperty("interact");
      expectTypeOf(entity).toHaveProperty("priority");
      expectTypeOf(entity.interact).toBeFunction();
      expectTypeOf(entity.priority).toBeNumber();
    } else {
      expect.unreachable();
    }
  });
});

describe("inheritance", () => {
  @trait(Interactable)
  class Light extends Entity {
    priority = 4;
    interact() {}
  }

  class BlinkingLight extends Light {
    override interact() {
      /* blink */
    }
  }

  it("subclass of traited class preserves parent traits", () => {
    const e = new BlinkingLight();
    expect(e.hasTrait(Interactable)).toBe(true);
  });

  it("subclass is instanceof Entity", () => {
    const e = new BlinkingLight();
    expect(e).toBeInstanceOf(Entity);
    expect(e).toBeInstanceOf(Light);
  });
});
