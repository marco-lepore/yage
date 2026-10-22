import { describe, expect, it, vi } from "vitest";
import { PerceptionMemory } from "./PerceptionMemory.js";
import type { PerceptionSample } from "./types.js";

const sample = (
  id = "target",
  reason: string | null = null,
): PerceptionSample<string> => ({
  id,
  target: id,
  position: { x: 10, y: 2 },
  visibility: 1,
  reason,
});

describe("PerceptionMemory", () => {
  it("detects once, preserves last success on loss, then forgets at the exact deadline", () => {
    const memory = new PerceptionMemory<string>(3);
    expect(memory.update(1, [sample()]).map((event) => event.type)).toEqual([
      "detected",
    ]);
    expect(memory.update(2, [sample()])).toEqual([]);
    expect(
      memory
        .update(3, [
          { ...sample("target", "occluded"), position: { x: 99, y: 99 } },
        ])
        .map((event) => event.type),
    ).toEqual(["lost"]);
    expect(memory.get("target")).toMatchObject({
      lastPosition: { x: 10, y: 2 },
      lastSeenAt: 2,
      lostAt: 3,
      visible: false,
      reason: "occluded",
    });
    expect(memory.update(4.99, [])).toEqual([]);
    expect(memory.update(5, []).map((event) => event.type)).toEqual([
      "forgotten",
    ]);
    expect(memory.observations).toEqual([]);
  });
  it("does not remember rejected targets and reacquires lost targets", () => {
    const memory = new PerceptionMemory<string>();
    expect(memory.update(0, [sample("a", "out-of-range")])).toEqual([]);
    expect(memory.observations).toEqual([]);
    memory.update(1, [sample()]);
    memory.update(2, []);
    expect(memory.update(2.5, [sample()]).map((event) => event.type)).toEqual([
      "detected",
    ]);
    expect(memory.get("target")).toMatchObject({
      firstSeenAt: 1,
      lastSeenAt: 2.5,
      lostAt: null,
    });
  });
  it("zero memory emits loss then forgotten, but successful observations remain", () => {
    const memory = new PerceptionMemory<string>(0);
    memory.update(0, [sample()]);
    expect(memory.detected).toHaveLength(1);
    expect(memory.update(0, []).map((event) => event.type)).toEqual([
      "lost",
      "forgotten",
    ]);
  });
  it("treats a changed runtime target with the same saved id as a new life", () => {
    const memory = new PerceptionMemory<object>();
    memory.update(0, [{ ...sample(), target: {} }]);
    const events = memory.update(1, [{ ...sample(), target: {} }]);
    expect(events.map((event) => event.type)).toEqual([
      "lost",
      "forgotten",
      "detected",
    ]);
    expect(memory.get("target")?.firstSeenAt).toBe(1);
  });
  it("validates a complete sample before changing state", () => {
    const memory = new PerceptionMemory<string>();
    memory.update(1, [sample()]);
    const before = memory.snapshot();
    expect(() =>
      memory.update(2, [sample("a"), { ...sample("b"), visibility: NaN }]),
    ).toThrow("visibility");
    expect(memory.snapshot()).toEqual(before);
    expect(() => memory.update(0, [])).toThrow("time");
    expect(() => memory.update(2, [sample(), sample()])).toThrow(
      "duplicate id",
    );
    expect(() =>
      memory.update(2, [{ ...sample(), position: { x: Infinity, y: 0 } }]),
    ).toThrow("position.x");
  });
  it.each([-1, NaN, Infinity])(
    "rejects invalid memory durations %s",
    (value) => {
      expect(() => new PerceptionMemory(value)).toThrow("constructor");
    },
  );
  it("returns frozen observations and positions", () => {
    const memory = new PerceptionMemory<string>();
    memory.update(0, [sample()]);
    const record = memory.observations[0]!;
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.lastPosition)).toBe(true);
  });
  it("round-trips data only, rebases all ages, and resolves targets explicitly", () => {
    const memory = new PerceptionMemory<string>(5);
    memory.update(10, [sample()]);
    memory.update(11, [sample()]);
    memory.update(12, []);
    const snapshot = JSON.parse(
      JSON.stringify(memory.snapshot(13)),
    ) as ReturnType<typeof memory.snapshot>;
    const restored = new PerceptionMemory<string>(5);
    restored.restore(snapshot, 0, (id) =>
      id === "target" ? "reconnected" : undefined,
    );
    expect(restored.get("target")).toMatchObject({
      target: "reconnected",
      visible: false,
      reason: "restored",
      firstSeenAt: -3,
      lastSeenAt: -2,
      lostAt: -1,
    });
    expect(restored.snapshot(0)).toEqual(snapshot);
    expect(restored.update(3, []).map((event) => event.type)).toEqual([
      "forgotten",
    ]);
    restored.restore(snapshot, 0, () => undefined);
    expect(restored.observations).toEqual([]);
  });
  it("validates restored records before resolving and leaves old state on failure", () => {
    const memory = new PerceptionMemory<string>();
    memory.update(0, [sample()]);
    const snapshot = memory.snapshot();
    const record = snapshot.records[0]!;
    const resolve = vi.fn(() => "target");
    expect(() =>
      memory.restore(
        { version: 1, records: [{ ...record, firstSeenAge: NaN }] },
        0,
        resolve,
      ),
    ).toThrow("firstSeenAge");
    expect(memory.snapshot()).toEqual(snapshot);
    expect(() =>
      memory.restore({ version: 1, records: [record, record] }, 0, resolve),
    ).toThrow("duplicate id");
    expect(resolve).not.toHaveBeenCalled();
  });
});
