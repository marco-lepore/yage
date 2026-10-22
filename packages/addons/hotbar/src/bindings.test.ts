import { describe, expect, it, vi } from "vitest";
import { Hotbar } from "./core/Hotbar.js";
import { hotbarAbility, hotbarItem } from "./bindings.js";
import type { HotbarAbilitySource, HotbarItemSource } from "./bindings.js";

function abilities(state: {
  canSend: boolean;
  remaining: number;
  ratio: number;
}) {
  const source = {
    canSend: vi.fn(() => state.canSend),
    send: vi.fn(() => ({ ok: true as const })),
    release: vi.fn(() => true),
    cooldownRemaining: vi.fn(() => state.remaining),
    cooldownRatio: vi.fn(() => state.ratio),
  } satisfies HotbarAbilitySource;
  return source;
}

function bag(state: { count: number; offered: boolean }) {
  const source = {
    catalog: { get: () => ({ name: "Potion", icon: "potion-icon" }) },
    count: () => state.count,
    firstSlot: () => (state.count > 0 ? 2 : undefined),
    getActions: () => (state.offered ? [{ id: "drink" }] : []),
    invokeAction: vi.fn((): { ok: boolean; reason?: string } =>
      state.offered ? { ok: true } : { ok: false, reason: "no-action" },
    ),
  } satisfies HotbarItemSource<"potion">;
  return source;
}

describe("hotbarAbility", () => {
  it("reads availability and cooldown from the ability owner", () => {
    const state = { canSend: false, remaining: 1.5, ratio: 0.25 };
    const source = abilities(state);
    const bar = new Hotbar({
      bindings: { zap: hotbarAbility(source, "zap", { label: "Zap" }) },
      slots: ["zap"],
    });
    expect(bar.read(0)).toMatchObject({
      available: false,
      reason: "cooldown",
      cooldown: { remaining: 1.5, ratio: 0.25 },
    });
    expect(source.canSend).toHaveBeenCalledWith("zap", { interrupts: true });
    Object.assign(state, { remaining: 0, ratio: 1 });
    expect(bar.read(0).reason).toBe("busy");
    state.canSend = true;
    expect(bar.activate(0)).toEqual({ ok: true });
    expect(source.send).toHaveBeenCalledWith("zap");
  });

  it("stays usable while a sendable combo step runs during the cooldown", () => {
    const source = abilities({ canSend: true, remaining: 1.7, ratio: 0.15 });
    const bar = new Hotbar({
      bindings: { attack: hotbarAbility(source, "attack", { label: "Hit" }) },
      slots: ["attack"],
    });
    expect(bar.read(0)).toMatchObject({
      available: true,
      reason: null,
      cooldown: null,
    });
    expect(bar.activate(0)).toEqual({ ok: true });
    expect(source.send).toHaveBeenCalledWith("attack");
  });

  it("releases the ability when the slot is released", () => {
    const source = abilities({ canSend: true, remaining: 0, ratio: 1 });
    const bar = new Hotbar({
      bindings: {
        charge: hotbarAbility(source, "charge", { label: "Charge" }),
      },
      slots: ["charge"],
    });
    bar.activate(0);
    bar.release(0);
    expect(source.release).toHaveBeenCalledWith("charge");
  });
});

describe("hotbarItem", () => {
  it("takes its label and icon from the catalog and counts every unit", () => {
    const bar = new Hotbar({
      bindings: {
        potion: hotbarItem(bag({ count: 4, offered: true }), "potion", {
          action: "drink",
        }),
      },
      slots: ["potion"],
    });
    expect(bar.read(0)).toMatchObject({
      label: "Potion",
      icon: "potion-icon",
      count: 4,
      available: true,
    });
  });

  it("invokes the action on the item's first stack", () => {
    const source = bag({ count: 4, offered: true });
    const bar = new Hotbar({
      bindings: { potion: hotbarItem(source, "potion", { action: "drink" }) },
      slots: ["potion"],
    });
    expect(bar.activate(0)).toEqual({ ok: true });
    expect(source.invokeAction).toHaveBeenCalledWith("drink", 2);
  });

  it("reports an empty item and an action the inventory does not offer", () => {
    const state = { count: 0, offered: true };
    const bar = new Hotbar({
      bindings: {
        potion: hotbarItem(bag(state), "potion", {
          action: "drink",
          label: "Tonic",
        }),
      },
      slots: ["potion"],
    });
    expect(bar.read(0)).toMatchObject({
      label: "Tonic",
      reason: "empty",
      count: 0,
    });
    Object.assign(state, { count: 1, offered: false });
    expect(bar.read(0).reason).toBe("unavailable");
  });
});
