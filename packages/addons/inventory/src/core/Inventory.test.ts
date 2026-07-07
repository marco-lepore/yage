import { describe, expect, it, vi } from "vitest";
import { defineItems } from "./catalog.js";
import { Inventory } from "./Inventory.js";
import { byName, byQuantity } from "./comparators.js";
import type { InventoryConstraint, ItemActionDef } from "./types.js";

const catalog = defineItems({
  potion: { name: "Potion", maxStack: 5, category: "consumable" },
  gem: { name: "Gem", maxStack: 99 },
  sword: { name: "Iron Sword", category: "gear" },
  arrows: { name: "Arrows", maxStack: 30, stacking: "single" },
  goldKey: { name: "Gold Key", category: "key" },
});

type Id = "potion" | "gem" | "sword" | "arrows" | "goldKey";

function make(opts: Partial<ConstructorParameters<typeof Inventory<Id>>[0]> = {}): Inventory<Id> {
  return new Inventory<Id>({ catalog, ...opts });
}

/** Narrow a lookup the test knows succeeds, keeping tests non-null-assertion-free. */
function found<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("expected a located stack");
  return v;
}

describe("add — multi stacking", () => {
  it("fills existing stacks before opening new slots", () => {
    const inv = make({ capacity: 6 });
    inv.add("potion", 3);
    const res = inv.add("potion", 4);
    expect(res).toMatchObject({ added: 4, rejected: 0 });
    // 3+2 tops the first stack to 5; the remaining 2 open slot 1.
    expect(inv.slots[0]).toEqual({ itemId: "potion", quantity: 5 });
    expect(inv.slots[1]).toEqual({ itemId: "potion", quantity: 2 });
    expect(res.slots).toEqual([0, 1]);
  });

  it("chunks a big add into maxStack-sized stacks", () => {
    const inv = make({ capacity: 6 });
    inv.add("potion", 12);
    expect(inv.slots.slice(0, 3)).toEqual([
      { itemId: "potion", quantity: 5 },
      { itemId: "potion", quantity: 5 },
      { itemId: "potion", quantity: 2 },
    ]);
    expect(inv.count("potion")).toBe(12);
  });

  it("accepts partially when slots run out, reason capacity", () => {
    const inv = make({ capacity: 2 });
    const res = inv.add("potion", 12);
    expect(res).toMatchObject({ added: 10, rejected: 2, reason: "capacity" });
    expect(inv.isFull).toBe(true);
  });

  it("defaults maxStack to 1 (unstackable unless declared)", () => {
    const inv = make({ capacity: 3 });
    inv.add("sword", 2);
    expect(inv.used).toBe(2);
    expect(inv.slots[0]).toEqual({ itemId: "sword", quantity: 1 });
  });

  it("honors a custom defaultMaxStack", () => {
    const inv = make({ capacity: 3, defaultMaxStack: 10 });
    inv.add("sword", 7);
    expect(inv.slots[0]).toEqual({ itemId: "sword", quantity: 7 });
  });

  it("grows an unbounded inventory instead of rejecting", () => {
    const inv = make();
    const res = inv.add("potion", 23);
    expect(res.rejected).toBe(0);
    expect(inv.slots.length).toBe(5);
    expect(inv.isFull).toBe(false);
  });
});

describe("add — single stacking (total cap)", () => {
  it("caps the item's total at maxStack and rejects the excess", () => {
    const inv = make({ capacity: 9 });
    expect(inv.add("arrows", 20).added).toBe(20);
    const res = inv.add("arrows", 20);
    expect(res).toMatchObject({ added: 10, rejected: 10, reason: "stack-cap" });
    // Still one stack, never a second slot.
    expect(inv.used).toBe(1);
    expect(inv.count("arrows")).toBe(30);
  });

  it("rejects entirely at cap", () => {
    const inv = make({ capacity: 9 });
    inv.add("arrows", 30);
    const res = inv.add("arrows", 1);
    expect(res).toMatchObject({ added: 0, rejected: 1, reason: "stack-cap" });
  });

  it("refuses a dataless top-up when the single stack carries data", () => {
    const inv = make({ capacity: 4 });
    inv.add("arrows", 5, { data: { enchant: "fire" } });
    const res = inv.add("arrows", 3);
    // Rejected, not folded into the instance stack — otherwise remove() (which
    // skips data stacks) could never take the anonymous units back out.
    expect(res).toMatchObject({ added: 0, rejected: 3, reason: "stack-cap" });
    expect(inv.slots[0]).toEqual({ itemId: "arrows", quantity: 5, data: { enchant: "fire" } });
    expect(inv.used).toBe(1);
  });
});

describe("add — data stacks", () => {
  it("never merges data stacks", () => {
    const inv = make({ capacity: 4, defaultMaxStack: 99 });
    inv.add("sword", 1, { data: { durability: 80 } });
    inv.add("sword", 1, { data: { durability: 80 } });
    expect(inv.used).toBe(2);
  });

  it("dataless units don't merge into a data stack", () => {
    const inv = make({ capacity: 4, defaultMaxStack: 99 });
    inv.add("sword", 1, { data: { durability: 80 } });
    inv.add("sword", 1);
    expect(inv.used).toBe(2);
    expect(inv.slots[0]?.data).toEqual({ durability: 80 });
    expect(inv.slots[1]?.data).toBeUndefined();
  });

  it("gives each chunked stack its own data object (no shared reference)", () => {
    const inv = make({ capacity: 6 });
    inv.add("potion", 12, { data: { charge: 1 } }); // 5 / 5 / 2, all data stacks
    const first = inv.slots[0]?.data;
    const second = inv.slots[1]?.data;
    const third = inv.slots[2]?.data;
    expect(first).toEqual({ charge: 1 });
    // Distinct instances — a runtime mutation of one payload can't leak into
    // its siblings.
    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
  });
});

describe("add — acceptance policy", () => {
  it("accepts predicate refuses with reason filtered", () => {
    const inv = make({ accepts: (def) => def.category === "key" });
    const refused = inv.add("potion", 3);
    expect(refused).toMatchObject({ added: 0, rejected: 3, reason: "filtered" });
    expect(inv.add("goldKey").added).toBe(1);
  });

  it("constraints clip the request with reason constraint and the clipping id", () => {
    const maxUnits3: InventoryConstraint<Id> = {
      id: "max-3-total",
      maxAcceptable: (_def, inv) => 3 - inv.slots.reduce((n, s) => n + (s?.quantity ?? 0), 0),
    };
    const inv = make({ constraints: [maxUnits3] });
    const rejections: unknown[] = [];
    inv.on("rejected", (e) => rejections.push(e));
    const res = inv.add("potion", 5);
    expect(res).toMatchObject({
      added: 3,
      rejected: 2,
      reason: "constraint",
      constraintId: "max-3-total",
    });
    expect(inv.add("potion", 1)).toMatchObject({ added: 0, reason: "constraint" });
    expect(rejections[0]).toMatchObject({ reason: "constraint", constraintId: "max-3-total" });
  });

  it("names the MOST limiting constraint when several clip", () => {
    const cap = (id: string, n: number): InventoryConstraint<Id> => ({
      id,
      maxAcceptable: () => n,
    });
    const inv = make({ constraints: [cap("loose", 4), cap("tight", 2)] });
    expect(inv.add("potion", 5)).toMatchObject({ added: 2, constraintId: "tight" });
  });

  it("treats a NaN-returning constraint as 0 instead of poisoning the result", () => {
    const broken: InventoryConstraint<Id> = { id: "broken", maxAcceptable: () => Number.NaN };
    const inv = make({ constraints: [broken] });
    const res = inv.add("potion", 3);
    expect(res).toEqual({
      added: 0,
      rejected: 3,
      reason: "constraint",
      constraintId: "broken",
      slots: [],
    });
    expect(inv.used).toBe(0);
  });

  it("Infinity from a constraint means no limit", () => {
    const open: InventoryConstraint<Id> = { maxAcceptable: () => Infinity };
    const inv = make({ capacity: 4, constraints: [open] });
    expect(inv.add("potion", 5)).toMatchObject({ added: 5, rejected: 0 });
  });

  it("throws on a non-positive quantity", () => {
    const inv = make();
    expect(() => inv.add("potion", 0)).toThrow(/positive integer/);
    expect(() => inv.add("potion", 1.5)).toThrow(/positive integer/);
  });
});

describe("remove", () => {
  it("drains from the last stack backwards", () => {
    const inv = make({ capacity: 6 });
    inv.add("potion", 12); // 5 / 5 / 2
    const res = inv.remove("potion", 3);
    expect(res.removed).toBe(3);
    expect(inv.slots[0]?.quantity).toBe(5);
    expect(inv.slots[1]?.quantity).toBe(4);
    expect(inv.slots[2]).toBeNull();
  });

  it("removes less than asked when short", () => {
    const inv = make();
    inv.add("potion", 2);
    expect(inv.remove("potion", 5).removed).toBe(2);
    expect(inv.count("potion")).toBe(0);
  });

  it("takes anonymous units before touching a data stack", () => {
    const inv = make({ capacity: 4, defaultMaxStack: 99 });
    inv.add("sword", 1, { data: { durability: 80 } }); // slot 0 — instance
    inv.add("sword", 2); // slot 1 — anonymous
    const res = inv.remove("sword", 2);
    expect(res.removed).toBe(2);
    expect(res.stacks).toEqual([{ itemId: "sword", quantity: 2 }]);
    // The instance sword is left alone while fungible units cover the ask.
    expect(inv.slots[0]?.data).toEqual({ durability: 80 });
  });

  it("dips into a data stack once anonymous units run out, returning its payload", () => {
    const inv = make({ capacity: 4, defaultMaxStack: 99 });
    inv.add("sword", 1, { data: { durability: 80 } });
    inv.add("sword", 2);
    const res = inv.remove("sword", 3);
    expect(res.removed).toBe(3);
    // Anonymous 2 first, then the instance sword — its data rides out in `stacks`
    // rather than being silently destroyed.
    expect(res.stacks).toEqual([
      { itemId: "sword", quantity: 2 },
      { itemId: "sword", quantity: 1, data: { durability: 80 } },
    ]);
    expect(inv.used).toBe(0);
  });

  it("removeAt takes part or all of one stack", () => {
    const inv = make({ capacity: 4 });
    inv.add("potion", 5);
    expect(inv.removeAt(0, 2).removed).toBe(2);
    expect(inv.slots[0]?.quantity).toBe(3);
    expect(inv.removeAt(0).removed).toBe(3);
    expect(inv.slots[0]).toBeNull();
    expect(inv.removeAt(0).removed).toBe(0);
  });

  it("autoCompact closes gaps on removal but not on move", () => {
    const inv = make({ capacity: 4, autoCompact: true });
    inv.add("potion", 5);
    inv.add("sword");
    inv.add("gem", 2);
    inv.removeAt(1); // sword out -> gem shifts up
    expect(inv.slots[1]).toEqual({ itemId: "gem", quantity: 2 });
    expect(inv.move(1, 3)).toEqual({ ok: true, effect: "moved" });
    expect(inv.slots[1]).toBeNull(); // arrangement is preserved
    expect(inv.slots[3]).toEqual({ itemId: "gem", quantity: 2 });
  });

  it("autoCompact reports slots shifted below the removal point", () => {
    const inv = make({ capacity: 5, autoCompact: true });
    inv.add("potion"); // slot 0
    inv.add("sword"); // slot 1
    inv.add("gem"); // slot 2
    // A move leaves a hole at slot 0, BELOW any later removal's start index —
    // move never compacts.
    expect(inv.move(0, 4)).toEqual({ ok: true, effect: "moved" }); // [null, sword, gem, null, potion]
    const changed: number[][] = [];
    inv.on("changed", (e) => changed.push([...e.slots]));
    inv.removeAt(1); // sword out -> gem 2->0, potion 4->1
    expect(inv.slots[0]).toEqual({ itemId: "gem", quantity: 1 });
    expect(inv.slots[1]).toEqual({ itemId: "potion", quantity: 1 });
    // Slot 0 shifted even though it sits below the removed slot 1 — the change
    // set must include it so a presenter re-renders it.
    expect(changed[0]).toContain(0);
  });
});

describe("data stacks — predicate queries + find/remove by ref", () => {
  const make99 = () => make({ capacity: 6, defaultMaxStack: 99 });

  it("count/has take a data predicate; anonymous stacks never match one", () => {
    const inv = make99();
    inv.add("gem", 5, { data: { quality: 90 } });
    inv.add("gem", 8, { data: { quality: 40 } });
    inv.add("gem", 3); // anonymous
    expect(inv.count("gem")).toBe(16); // no predicate → everything
    expect(inv.count("gem", (d) => (d.quality as number) > 80)).toBe(5);
    expect(inv.has("gem", (d) => (d.quality as number) > 80)).toBe(true);
    expect(inv.has("gem", 6, (d) => (d.quality as number) > 80)).toBe(false); // only 5 good
    // A predicate is a question about instances — the anonymous 3 are excluded.
    expect(inv.count("gem", () => true)).toBe(13);
  });

  it("find returns a located ref; remove(ref) takes exactly it, data and all", () => {
    const inv = make99();
    inv.add("goldKey", 1, { data: { opens: "boss-lair" } });
    inv.add("goldKey", 1, { data: { opens: "cellar" } });
    const boss = inv.find("goldKey", (d) => d.opens === "boss-lair");
    expect(boss?.slot).toBe(0);
    const res = inv.remove(found(boss));
    expect(res.removed).toBe(1);
    expect(res.stacks).toEqual([{ itemId: "goldKey", quantity: 1, data: { opens: "boss-lair" } }]);
    // The other key is untouched.
    expect(inv.count("goldKey")).toBe(1);
    expect(inv.find("goldKey", (d) => d.opens === "cellar")).toBeDefined();
  });

  it("findAll lists every match; predicate remove drains only matching data stacks", () => {
    const inv = make99();
    inv.add("gem", 5, { data: { quality: 90 } });
    inv.add("gem", 8, { data: { quality: 40 } });
    inv.add("gem", 3); // anonymous
    expect(inv.findAll("gem")).toHaveLength(3);
    expect(inv.findAll("gem", (d) => (d.quality as number) < 50)).toHaveLength(1);
    const res = inv.remove("gem", 99, (d) => (d.quality as number) < 50);
    expect(res.removed).toBe(8);
    expect(res.stacks).toEqual([{ itemId: "gem", quantity: 8, data: { quality: 40 } }]);
    // The good gems and the anonymous stack survive.
    expect(inv.count("gem")).toBe(8);
  });

  it("a stale ref (its stack replaced) is a safe no-op", () => {
    const inv = make99();
    inv.add("gem", 2, { data: { quality: 90 } });
    const ref = found(inv.find("gem"));
    inv.removeAt(ref.slot); // stack removed out from under the ref
    expect(inv.remove(ref)).toEqual({ removed: 0, stacks: [] });
  });

  it("remove(ref) follows a stack that autoCompact shifted", () => {
    const inv = make({ capacity: 4, autoCompact: true, defaultMaxStack: 99 });
    inv.add("potion", 3); // slot 0 — anonymous
    inv.add("gem", 1, { data: { quality: 90 } }); // slot 1 — instance
    const gem = found(inv.find("gem"));
    expect(gem.slot).toBe(1);
    inv.remove("potion", 3); // slot 0 empties; autoCompact shifts gem to slot 0
    const res = inv.remove(gem); // resolves by identity despite the moved index
    expect(res.removed).toBe(1);
    expect(res.stacks).toEqual([{ itemId: "gem", quantity: 1, data: { quality: 90 } }]);
    expect(inv.used).toBe(0);
  });
});

describe("setSlot / clear", () => {
  it("setSlot writes verbatim and validates", () => {
    const inv = make({ capacity: 3 });
    inv.setSlot(2, { itemId: "potion", quantity: 42 }); // beyond maxStack — verbatim
    expect(inv.slots[2]?.quantity).toBe(42);
    expect(() => inv.setSlot(3, null)).toThrow(/out of range/);
    expect(() => inv.setSlot(0, { itemId: "nope" as Id, quantity: 1 })).toThrow(/unknown item/);
    expect(() => inv.setSlot(0, { itemId: "potion", quantity: 0 })).toThrow(/positive integer/);
  });

  it("clear empties everything with a single changed event", () => {
    const inv = make({ capacity: 3 });
    inv.add("potion", 2);
    const changed = vi.fn();
    const removed = vi.fn();
    inv.on("changed", changed);
    inv.on("itemRemoved", removed);
    inv.clear();
    expect(inv.used).toBe(0);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });
});

describe("move / split", () => {
  it("moves onto an empty slot", () => {
    const inv = make({ capacity: 4 });
    inv.add("potion", 2);
    expect(inv.move(0, 3)).toEqual({ ok: true, effect: "moved" });
    expect(inv.slots[0]).toBeNull();
    expect(inv.slots[3]?.quantity).toBe(2);
  });

  it("merges same-item stacks up to maxStack, leftover stays", () => {
    const inv = make({ capacity: 4 });
    inv.setSlot(0, { itemId: "potion", quantity: 4 });
    inv.setSlot(1, { itemId: "potion", quantity: 3 });
    expect(inv.move(1, 0)).toEqual({ ok: true, effect: "merged" });
    expect(inv.slots[0]?.quantity).toBe(5);
    expect(inv.slots[1]?.quantity).toBe(2);
  });

  it("merging into a full stack swaps instead", () => {
    const inv = make({ capacity: 4 });
    inv.setSlot(0, { itemId: "potion", quantity: 5 });
    inv.setSlot(1, { itemId: "potion", quantity: 2 });
    expect(inv.move(1, 0)).toEqual({ ok: true, effect: "swapped" });
    expect(inv.slots[0]?.quantity).toBe(2);
    expect(inv.slots[1]?.quantity).toBe(5);
  });

  it("swaps different items and data stacks", () => {
    const inv = make({ capacity: 4, defaultMaxStack: 99 });
    inv.add("sword", 1, { data: { durability: 10 } });
    inv.add("sword", 1);
    expect(inv.move(0, 1)).toEqual({ ok: true, effect: "swapped" });
    expect(inv.slots[1]?.data).toEqual({ durability: 10 });
  });

  it("refuses a same-slot or out-of-range target on bounded inventories", () => {
    const inv = make({ capacity: 2 });
    inv.add("potion");
    expect(inv.move(0, 2)).toEqual({ ok: false, reason: "out-of-range" });
    expect(inv.move(0, 0)).toEqual({ ok: false, reason: "same-slot" });
    expect(inv.move(1, 0)).toEqual({ ok: false, reason: "empty" }); // empty source
  });

  it("grows an unbounded inventory to reach the target slot", () => {
    const inv = make();
    inv.add("potion");
    expect(inv.move(0, 4)).toEqual({ ok: true, effect: "moved" });
    expect(inv.slots.length).toBe(5);
    expect(inv.slots[4]?.itemId).toBe("potion");
  });

  it("split moves part of a stack to the first empty (or given) slot", () => {
    const inv = make({ capacity: 4 });
    inv.add("potion", 5);
    expect(inv.split(0, 2)).toEqual({ ok: true });
    expect(inv.slots[0]?.quantity).toBe(3);
    expect(inv.slots[1]?.quantity).toBe(2);
    expect(inv.split(0, 1, 3)).toEqual({ ok: true });
    expect(inv.slots[3]?.quantity).toBe(1);
  });

  it("split refuses whole-stack amounts and occupied or out-of-range targets", () => {
    const inv = make({ capacity: 4 });
    inv.add("potion", 5);
    inv.add("sword");
    expect(inv.split(0, 5)).toEqual({ ok: false, reason: "indivisible" }); // whole stack -> use move
    expect(inv.split(0, 2, 1)).toEqual({ ok: false, reason: "occupied" });
    expect(inv.split(0, 2, 4)).toEqual({ ok: false, reason: "out-of-range" });
    expect(inv.split(0, 2, 0)).toEqual({ ok: false, reason: "same-slot" });
  });

  it("split with no explicit target refuses when the inventory has no free slot", () => {
    const inv = make({ capacity: 2 });
    inv.add("potion", 5);
    inv.add("sword");
    expect(inv.split(0, 2)).toEqual({ ok: false, reason: "capacity" });
  });
});

describe("sort", () => {
  it("consolidates partial stacks then orders by catalog order by default", () => {
    const inv = make({ capacity: 8 });
    inv.setSlot(5, { itemId: "sword", quantity: 1 });
    inv.setSlot(1, { itemId: "potion", quantity: 2 });
    inv.setSlot(3, { itemId: "potion", quantity: 2 });
    inv.setSlot(6, { itemId: "gem", quantity: 4 });
    inv.sort();
    expect(inv.slots.slice(0, 4)).toEqual([
      { itemId: "potion", quantity: 4 }, // 2+2 consolidated
      { itemId: "gem", quantity: 4 },
      { itemId: "sword", quantity: 1 },
      null,
    ]);
  });

  it("respects consolidate: false", () => {
    const inv = make({ capacity: 8 });
    inv.setSlot(1, { itemId: "potion", quantity: 2 });
    inv.setSlot(3, { itemId: "potion", quantity: 2 });
    inv.sort(undefined, { consolidate: false });
    expect(inv.slots[0]?.quantity).toBe(2);
    expect(inv.slots[1]?.quantity).toBe(2);
  });

  it("takes custom comparators", () => {
    const inv = make({ capacity: 8 });
    inv.add("sword");
    inv.add("gem", 3);
    inv.add("potion", 2);
    inv.sort(byName);
    expect(inv.slots.slice(0, 3).map((s) => s?.itemId)).toEqual(["gem", "sword", "potion"]);
    inv.sort(byQuantity);
    expect(inv.slots.slice(0, 3).map((s) => s?.itemId)).toEqual(["gem", "potion", "sword"]);
  });

  it("keeps data stacks and single-stacking items unconsolidated", () => {
    const inv = make({ capacity: 8, defaultMaxStack: 99 });
    inv.add("sword", 1, { data: { durability: 10 } });
    inv.add("sword", 1, { data: { durability: 90 } });
    inv.add("arrows", 20);
    inv.sort();
    expect(inv.used).toBe(3);
    const swords = inv.stacks().filter((s) => s.stack.itemId === "sword");
    expect(swords).toHaveLength(2);
  });
});

describe("transfer", () => {
  it("moves only what the target accepts — no item destruction", () => {
    const src = make({ capacity: 4 });
    const dst = make({ capacity: 1 });
    src.add("potion", 12); // 5/5/2
    const res = src.transfer(dst, "potion", 12);
    expect(res).toMatchObject({ transferred: 5, rejected: 7, reason: "capacity" });
    expect(src.count("potion")).toBe(7);
    expect(dst.count("potion")).toBe(5);
  });

  it("respects the target's accepts filter", () => {
    const src = make();
    const pouch = make({ accepts: (def) => def.category === "key" });
    src.add("potion", 2);
    const res = src.transfer(pouch, "potion", 2);
    expect(res).toMatchObject({ transferred: 0, rejected: 2, reason: "filtered" });
    expect(src.count("potion")).toBe(2);
  });

  it("carries data stacks, payload intact", () => {
    const src = make({ capacity: 4, defaultMaxStack: 99 });
    const dst = make({ capacity: 4, defaultMaxStack: 99 });
    src.add("sword", 1, { data: { durability: 42 } });
    const res = src.transfer(dst, "sword", 1);
    expect(res.transferred).toBe(1);
    expect(dst.slots[0]?.data).toEqual({ durability: 42 });
    expect(src.used).toBe(0);
  });

  it("prefers anonymous stacks, then data — each moved with its own payload", () => {
    const src = make({ capacity: 4, defaultMaxStack: 99 });
    const dst = make({ capacity: 4, defaultMaxStack: 99 });
    src.add("gem", 1, { data: { quality: 90 } }); // slot 0 — instance
    src.add("gem", 2); // slot 1 — anonymous
    expect(src.transfer(dst, "gem", 3).transferred).toBe(3);
    expect(src.used).toBe(0);
    expect(dst.count("gem")).toBe(3);
    // The instance kept its own slot and payload on the target.
    expect(dst.find("gem", (d) => (d.quality as number) === 90)).toBeDefined();
  });

  it("transfer(ref) moves exactly one located stack", () => {
    const src = make({ capacity: 4, defaultMaxStack: 99 });
    const dst = make({ capacity: 4, defaultMaxStack: 99 });
    src.add("goldKey", 1, { data: { opens: "boss-lair" } });
    src.add("goldKey", 1, { data: { opens: "cellar" } });
    const boss = found(src.find("goldKey", (d) => d.opens === "boss-lair"));
    expect(src.transfer(dst, boss).transferred).toBe(1);
    expect(dst.slots[0]?.data).toEqual({ opens: "boss-lair" });
    expect(src.count("goldKey")).toBe(1);
  });

  it("transfer with a predicate moves only matching data stacks", () => {
    const src = make({ capacity: 4, defaultMaxStack: 99 });
    const dst = make({ capacity: 4, defaultMaxStack: 99 });
    src.add("gem", 5, { data: { quality: 90 } });
    src.add("gem", 8, { data: { quality: 40 } });
    const res = src.transfer(dst, "gem", 99, (d) => (d.quality as number) > 80);
    expect(res.transferred).toBe(5);
    expect(dst.count("gem")).toBe(5);
    expect(src.count("gem")).toBe(8); // the poor gems stayed
  });

  it("self-transfer is a no-op", () => {
    const inv = make();
    inv.add("potion", 2);
    expect(inv.transfer(inv, "potion", 2)).toEqual({ transferred: 0, rejected: 0 });
    expect(inv.count("potion")).toBe(2);
  });
});

describe("actions", () => {
  const use: ItemActionDef<Id> = {
    id: "use",
    label: "Use",
    consumes: true,
    available: (ctx) => ctx.def.category === "consumable",
  };
  const drop: ItemActionDef<Id> = { id: "drop", label: "Drop" };
  const inspect: ItemActionDef<Id> = { id: "inspect", label: "Inspect" };

  it("resolves per-item actions: ItemDef.actions narrows, available gates", () => {
    const narrowCatalog = defineItems({
      potion: { name: "Potion", category: "consumable" },
      sword: { name: "Sword", actions: ["drop"] },
    });
    const inv = new Inventory({ catalog: narrowCatalog, actions: [use, drop, inspect] });
    inv.add("potion");
    inv.add("sword");
    expect(inv.getActions(0).map((a) => a.id)).toEqual(["use", "drop", "inspect"]);
    expect(inv.getActions(1).map((a) => a.id)).toEqual(["drop"]);
    expect(inv.getActions(5)).toEqual([]);
  });

  it("invokeAction emits the event, then consumes one unit when asked", () => {
    const inv = make({ actions: [use, drop] });
    inv.add("potion", 3);
    const seen: unknown[] = [];
    inv.on("action", (e) => seen.push({ ...e, countAtEmit: inv.count("potion") }));
    expect(inv.invokeAction("use", 0)).toEqual({ ok: true });
    // The event fires BEFORE the consume removal (quantity is pre-consume).
    expect(seen).toEqual([
      { actionId: "use", slot: 0, itemId: "potion", quantity: 3, consumes: true, countAtEmit: 3 },
    ]);
    expect(inv.count("potion")).toBe(2);
  });

  it("refuses actions that aren't currently offered, and empty slots", () => {
    const inv = make({ actions: [use] });
    inv.add("sword"); // not a consumable -> use unavailable
    expect(inv.invokeAction("use", 0)).toEqual({ ok: false, reason: "no-action" });
    expect(inv.invokeAction("use", 3)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("events", () => {
  it("emits itemAdded/rejected and a single changed per add", () => {
    const inv = make({ capacity: 2 });
    const events: string[] = [];
    inv.on("itemAdded", (e) => events.push(`added:${e.quantity}@${e.slots.join(",")}`));
    inv.on("rejected", (e) => events.push(`rejected:${e.quantity}:${e.reason}`));
    inv.on("changed", (e) => events.push(`changed:${e.slots.join(",")}`));
    inv.add("potion", 12);
    expect(events).toEqual(["added:10@0,1", "rejected:2:capacity", "changed:0,1"]);
  });

  it("emits one aggregated itemRemoved per remove()", () => {
    const inv = make({ capacity: 4 });
    inv.add("potion", 8); // 5/3
    const removed = vi.fn();
    inv.on("itemRemoved", removed);
    inv.remove("potion", 6);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith({ itemId: "potion", quantity: 6 });
  });

  it("unsubscribe stops delivery", () => {
    const inv = make();
    const fn = vi.fn();
    const off = inv.on("changed", fn);
    inv.add("potion");
    off();
    inv.add("potion");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("snapshot / restore", () => {
  it("round-trips full state including data", () => {
    const a = make({ capacity: 4, defaultMaxStack: 99 });
    a.add("potion", 5);
    a.add("sword", 1, { data: { durability: 66 } });
    const snap = a.snapshot();

    const b = make({ capacity: 4, defaultMaxStack: 99 });
    const { dropped } = b.restore(snap);
    expect(dropped).toEqual([]);
    expect(b.snapshot()).toEqual(snap);
    expect(b.slots[1]?.data).toEqual({ durability: 66 });
  });

  it("snapshot is a detached copy", () => {
    const inv = make({ capacity: 2 });
    inv.add("potion", 2);
    const snap = inv.snapshot();
    inv.add("potion", 1);
    expect(snap.slots[0]?.quantity).toBe(2);
  });

  it("drops unknown ids and invalid quantities", () => {
    const inv = make({ capacity: 3 });
    const { dropped } = inv.restore({
      slots: [
        { itemId: "potion", quantity: 2 },
        { itemId: "ghost", quantity: 1 }, // unknown id
        { itemId: "gem", quantity: 0 }, // non-positive quantity
      ],
    });
    expect(inv.slots).toEqual([{ itemId: "potion", quantity: 2 }, null, null]);
    expect(dropped.map((d) => d.itemId)).toEqual(["ghost", "gem"]);
  });

  it("re-flows entries beyond a shrunk capacity into the earliest free slots", () => {
    // A save from a larger bag: items sit in high slots, low ones are empty —
    // all still fit the smaller bag, so nothing is lost.
    const inv = make({ capacity: 3 });
    const { dropped } = inv.restore({
      slots: [null, null, null, { itemId: "sword", quantity: 1 }, { itemId: "gem", quantity: 4 }],
    });
    expect(dropped).toEqual([]);
    // Overflow lands in slot order: first overflow entry → first free slot.
    expect(inv.slots).toEqual([
      { itemId: "sword", quantity: 1 },
      { itemId: "gem", quantity: 4 },
      null,
    ]);
  });

  it("keeps in-range entries put; overflow only fills the holes", () => {
    const inv = make({ capacity: 3 });
    const { dropped } = inv.restore({
      slots: [
        { itemId: "potion", quantity: 2 }, // in-range → stays at slot 0
        null, // in-range hole
        { itemId: "sword", quantity: 1 }, // in-range → stays at slot 2
        { itemId: "gem", quantity: 4 }, // overflow → the slot-1 hole
      ],
    });
    expect(dropped).toEqual([]);
    expect(inv.slots).toEqual([
      { itemId: "potion", quantity: 2 },
      { itemId: "gem", quantity: 4 },
      { itemId: "sword", quantity: 1 },
    ]);
  });

  it("drops overflow only when the bag has no free slot left", () => {
    const inv = make({ capacity: 2 });
    const { dropped } = inv.restore({
      slots: [
        { itemId: "potion", quantity: 2 },
        { itemId: "gem", quantity: 4 },
        { itemId: "sword", quantity: 1 }, // no room → dropped
      ],
    });
    expect(inv.slots).toEqual([
      { itemId: "potion", quantity: 2 },
      { itemId: "gem", quantity: 4 },
    ]);
    expect(dropped.map((d) => d.itemId)).toEqual(["sword"]);
  });

  it("restores an in-range oversized quantity verbatim (same trust as setSlot)", () => {
    const inv = make({ capacity: 2 }); // potion maxStack 5
    inv.restore({ slots: [{ itemId: "potion", quantity: 99 }] });
    expect(inv.slots[0]).toEqual({ itemId: "potion", quantity: 99 });
  });

  it("trims trailing empties on unbounded inventories", () => {
    const inv = make();
    inv.restore({ slots: [{ itemId: "potion", quantity: 1 }, null, null] });
    expect(inv.slots.length).toBe(1);
  });
});
