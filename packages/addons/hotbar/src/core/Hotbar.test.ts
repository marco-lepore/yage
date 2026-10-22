import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { ErrorBoundary, Logger } from "@yagejs/core";
import { Hotbar } from "./Hotbar.js";
import type { HotbarActionResult } from "./types.js";

const action = () => ({
  label: "Action",
  activate: vi.fn(() => ({ ok: true as const })),
});

describe("Hotbar", () => {
  it("infers catalog IDs and keeps assignment operations independent of activation", () => {
    const a = action();
    const model = new Hotbar({
      bindings: { a, b: action() },
      slots: ["a"],
      slotCount: 3,
    });
    expectTypeOf(model.bindingIds).toEqualTypeOf<readonly ("a" | "b")[]>();
    model.assign(1, "a");
    model.swap(0, 2);
    model.clear(1);
    expect(model.snapshot().slots).toEqual([null, null, "a"]);
    expect(a.activate).not.toHaveBeenCalled();
    model.select(2);
    model.cycle(1);
    expect(model.selection).toBe(0);
    model.cycle(-1);
    expect(model.selection).toBe(2);
  });

  it("reads authoritative state on each activation and retains depleted assignments", () => {
    let count = 1;
    const activate = vi.fn(() => {
      count--;
      return { ok: true as const };
    });
    const model = new Hotbar({
      bindings: {
        potion: {
          label: "Potion",
          read: () => ({ available: count > 0, reason: "depleted", count }),
          activate,
        },
      },
      slots: ["potion"],
    });
    expect(model.activate()).toEqual({ ok: true });
    expect(model.activate()).toEqual({ ok: false, reason: "depleted" });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(model.read(0)).toMatchObject({
      bindingId: "potion",
      count: 0,
      available: false,
    });
    expect(model.lastActivation).toMatchObject({
      slot: 0,
      bindingId: "potion",
      result: { reason: "depleted" },
    });
  });

  it("blocks on cooldown without advancing a second clock", () => {
    let remaining = 2;
    const a = action();
    const model = new Hotbar({
      bindings: {
        a: {
          ...a,
          read: () => ({ cooldown: { remaining, ratio: 1 - remaining / 2 } }),
        },
      },
      slots: ["a"],
    });
    expect(model.activate()).toEqual({ ok: false, reason: "cooldown" });
    remaining = 0;
    expect(model.activate()).toEqual({ ok: true });
    expect(a.activate).toHaveBeenCalledTimes(1);
  });

  it("reports a running cooldown when the owner gives no reason", () => {
    let reason: string | null = null;
    const model = new Hotbar({
      bindings: {
        a: {
          ...action(),
          read: () => ({
            available: false,
            ...(reason !== null && { reason }),
            cooldown: { remaining: 1, ratio: 0.5 },
          }),
        },
      },
      slots: ["a"],
    });
    expect(model.read(0).reason).toBe("cooldown");
    reason = "silenced";
    expect(model.read(0).reason).toBe("silenced");
  });

  it.each([NaN, -0.1, 1.5])(
    "rejects cooldown ratio %s at the callback boundary",
    (ratio) => {
      const model = new Hotbar({
        errorBoundary: new ErrorBoundary(new Logger({ output: () => {} })),
        bindings: {
          a: {
            ...action(),
            read: () => ({ cooldown: { remaining: 1, ratio } }),
          },
        },
        slots: ["a"],
      });
      expect(() => model.read(0)).toThrow("ratio");
    },
  );

  it("reports owner rejections and empty slots", () => {
    const model = new Hotbar({
      bindings: {
        a: {
          label: "A",
          activate: () => ({ ok: false, reason: "out of range" }),
        },
      },
      slots: ["a"],
    });
    expect(model.activate()).toEqual({ ok: false, reason: "out of range" });
    expect(model.activate(1)).toEqual({ ok: false, reason: "empty" });
  });

  it("restores assignments and selection from a JSON round trip", () => {
    const model = new Hotbar({
      bindings: { a: action() },
      slots: ["a"],
      slotCount: 2,
    });
    model.select(1);
    const saved = JSON.parse(JSON.stringify(model.snapshot())) as ReturnType<
      typeof model.snapshot
    >;
    model.swap(0, 1);
    model.select(0);
    expect(model.restore(saved)).toEqual({ dropped: [] });
    expect(model.snapshot()).toEqual(saved);
  });

  it("leaves unknown and out-of-range entries empty and reports them", () => {
    const model = new Hotbar({
      bindings: { a: action(), b: action() },
      slots: ["a", "b"],
      slotCount: 2,
    });
    const changed = vi.fn();
    model.on(changed);
    const result = model.restore({
      version: 1,
      slots: ["removed", "a", "b"],
      selected: 2,
    });
    expect(result.dropped).toEqual([
      { slot: 0, bindingId: "removed" },
      { slot: 2, bindingId: "b" },
    ]);
    expect(model.snapshot()).toEqual({
      version: 1,
      slots: [null, "a"],
      selected: 0,
    });
    expect(changed).toHaveBeenCalledOnce();
    expect(() =>
      model.restore({ version: 2, slots: [], selected: 0 } as never),
    ).toThrow("version");
  });

  it.each([
    [{ version: 1, slots: null, selected: 0 }, "slots must be an array"],
    [{ version: 1, slots: ["a", 7], selected: 0 }, "slot 1 must hold"],
  ])("rejects a malformed snapshot before changing anything", (bad, error) => {
    const model = new Hotbar({ bindings: { a: action() }, slots: ["a"] });
    model.select(1);
    const before = model.snapshot();
    expect(() => model.restore(bad as never)).toThrow(error);
    expect(model.snapshot()).toEqual(before);
  });

  it.each([NaN, Infinity, -1, 1.5])(
    "rejects invalid slot count %s",
    (slotCount) => {
      expect(() => new Hotbar({ bindings: {}, slotCount })).toThrow(
        "slotCount",
      );
    },
  );

  it.each([NaN, Infinity, -1, 8, 1.5])(
    "validates both indexes before a swap: %s",
    (slot) => {
      const model = new Hotbar({ bindings: { a: action() }, slots: ["a"] });
      const before = model.snapshot();
      expect(() => model.swap(0, slot)).toThrow("slot");
      expect(model.snapshot()).toEqual(before);
    },
  );

  it("attributes callback failures, rethrows, and stops event fan-out", () => {
    const boundary = new ErrorBoundary(new Logger({ output: () => {} }));
    const model = new Hotbar({
      errorBoundary: boundary,
      bindings: {
        a: {
          label: "A",
          activate: () => {
            throw new Error("owner failure");
          },
        },
      },
      slots: ["a"],
    });
    expect(() => model.activate()).toThrow("owner failure");
    expect(boundary.getCallbackErrors()[0]).toMatchObject({
      kind: "Hotbar activate 'a'",
      error: "owner failure",
    });
    expect(model.lastActivation).toBeNull();
    const later = vi.fn();
    model.on(() => {
      throw new Error("listener failed");
    });
    model.on(later);
    expect(() => model.clear(0)).toThrow("listener failed");
    expect(later).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -1])(
    "rejects invalid count %s at the callback boundary",
    (count) => {
      const boundary = new ErrorBoundary(new Logger({ output: () => {} }));
      const model = new Hotbar({
        errorBoundary: boundary,
        bindings: { a: { ...action(), read: () => ({ count }) } },
        slots: ["a"],
      });
      expect(() => model.read(0)).toThrow("finite and nonnegative");
      expect(boundary.getCallbackErrors()[0]?.kind).toBe("Hotbar read 'a'");
    },
  );

  it("does not expose mutable durable state through snapshots", () => {
    const model = new Hotbar({ bindings: { a: action() }, slots: ["a"] });
    const saved = model.snapshot();
    (saved.slots as (string | null)[])[0] = null;
    expect(model.read(0).bindingId).toBe("a");
  });

  it("releases the binding a slot activated, once, even after reassignment", () => {
    const release = vi.fn();
    const model = new Hotbar({
      bindings: { charge: { ...action(), release }, other: action() },
      slots: ["charge"],
    });
    model.activate(0);
    model.assign(0, "other");
    model.release(0);
    model.release(0);
    expect(release).toHaveBeenCalledOnce();
  });

  it("ends a slot's earlier hold before the slot's next activation runs", () => {
    const log: string[] = [];
    const binding = (name: string) => ({
      label: name,
      activate: () => {
        log.push(`activate ${name}`);
        return { ok: true as const };
      },
      release: () => log.push(`release ${name}`),
    });
    const model = new Hotbar({
      bindings: { a: binding("a"), b: binding("b") },
      slots: ["a"],
    });
    model.activate(0);
    model.assign(0, "b");
    model.activate(0);
    model.release(0);
    model.release(0);
    expect(log).toEqual(["activate a", "release a", "activate b", "release b"]);
  });

  it("keeps a slot's hold when read() rejects the next activation", () => {
    const release = vi.fn();
    let cooling = false;
    const model = new Hotbar({
      bindings: {
        charge: {
          ...action(),
          read: () => ({ available: !cooling }),
          release,
        },
      },
      slots: ["charge"],
    });
    model.activate(0);
    cooling = true;
    expect(model.activate(0)).toEqual({ ok: false, reason: "unavailable" });
    expect(release).not.toHaveBeenCalled();
    model.release(0);
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases nothing after a rejected activation", () => {
    const release = vi.fn();
    const model = new Hotbar({
      bindings: {
        charge: {
          label: "Charge",
          activate: () => ({ ok: false, reason: "busy" }),
          release,
        },
      },
      slots: ["charge"],
    });
    model.activate(0);
    model.release(0);
    expect(release).not.toHaveBeenCalled();
  });

  it("throws when a binding activates its own slot, and allows other slots", () => {
    const boundary = new ErrorBoundary(new Logger({ output: () => {} }));
    const other = action();
    let target = 0;
    const model = new Hotbar({
      errorBoundary: boundary,
      bindings: {
        macro: {
          label: "Macro",
          activate: (): HotbarActionResult => model.activate(target),
        },
        other,
      },
      slots: ["macro", "other"],
    });
    expect(() => model.activate(0)).toThrow(
      "slot 0 was activated again while its activate() was running",
    );
    expect(boundary.getCallbackErrors()[0]?.kind).toBe(
      "Hotbar activate 'macro'",
    );
    target = 1;
    expect(model.activate(0)).toEqual({ ok: true });
    expect(other.activate).toHaveBeenCalledOnce();
  });

  it("rejects an asynchronous activation result", () => {
    const model = new Hotbar({
      errorBoundary: new ErrorBoundary(new Logger({ output: () => {} })),
      bindings: {
        a: {
          label: "A",
          activate: (() => Promise.resolve({ ok: true })) as never,
        },
      },
      slots: ["a"],
    });
    expect(() => model.activate()).toThrow("synchronous");
  });
});
