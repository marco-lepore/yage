import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { ErrorBoundary, Logger } from "@yagejs/core";
import { Hotbar } from "./Hotbar.js";

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
        a: { ...a, read: () => ({ cooldown: { remaining, total: 2 } }) },
      },
      slots: ["a"],
    });
    expect(model.activate()).toEqual({ ok: false, reason: "cooldown" });
    remaining = 0;
    expect(model.activate()).toEqual({ ok: true });
    expect(a.activate).toHaveBeenCalledTimes(1);
  });

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

  it("restores all assignments and selection atomically", () => {
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
    model.restore(saved);
    expect(model.snapshot()).toEqual(saved);
    expect(() =>
      model.restore({ version: 1, slots: [null, "missing"], selected: 0 }),
    ).toThrow("missing");
    expect(model.snapshot()).toEqual(saved);
    expect(() => model.restore({ ...saved, selected: NaN })).toThrow("slot");
    expect(() => model.restore({ ...saved, slots: [] })).toThrow("slot count");
  });

  it.each([NaN, Infinity, -1, 1.5, 1025])(
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
      expect(() => model.read(0)).toThrow("finite nonnegative");
      expect(boundary.getCallbackErrors()[0]?.kind).toBe("Hotbar read 'a'");
    },
  );

  it("does not expose mutable durable state through snapshots", () => {
    const model = new Hotbar({ bindings: { a: action() }, slots: ["a"] });
    const saved = model.snapshot();
    (saved.slots as (string | null)[])[0] = null;
    expect(model.read(0).bindingId).toBe("a");
  });

  it("rejects recursive activation without swallowing the error", () => {
    const boundary = new ErrorBoundary(new Logger({ output: () => {} }));
    const model: Hotbar<"a"> = new Hotbar({
      errorBoundary: boundary,
      bindings: { a: { label: "A", activate: () => model.activate() } },
      slots: ["a"],
    });
    expect(() => model.activate()).toThrow("recursive");
  });
});
