import { expect, it } from "vitest";
import { CaveGenerator } from "./CaveGenerator.js";
import { createTileMapGraph } from "../navigation.js";
it("generates connected caves without rooms and preserves determinism across chunks", () => {
  for (let seed = 0; seed < 20; seed++) {
    const options = { seed, width: 32, height: 24 };
    const a = new CaveGenerator(options),
      b = new CaveGenerator(options);
    while (a.status === "running") a.step(17);
    b.generate();
    expect(a.result).toEqual(b.result);
    const map = a.result!;
    expect(map.cells).toHaveLength(24);
    expect(map.cells[0]).toBe("#".repeat(32));
    expect(map.cells[23]).toBe("#".repeat(32));
    const nav = createTileMapGraph(map, { tileWidth: 1, tileHeight: 1 });
    const floors = map.cells.flatMap((row, y) =>
      [...row].flatMap((c, x) =>
        c === "." ? [{ x: x + 0.5, y: y + 0.5 }] : [],
      ),
    );
    expect(floors.length).toBeGreaterThan(0);
    for (const p of floors.filter((_, i) => i % 11 === 0))
      expect(nav.findPath(floors[0]!, p)).not.toBeNull();
  }
});
it("handles solid input, cancellation, budgets and invalid numeric input", () => {
  const solid = new CaveGenerator({
    seed: 1,
    width: 3,
    height: 3,
    wallProbability: 1,
  });
  expect(solid.generate()!.cells).toEqual(["###", "#.#", "###"]);
  const budget = new CaveGenerator({
    seed: 0,
    width: 32,
    height: 32,
    maxSteps: 1,
  });
  expect(budget.generate()).toBeNull();
  expect(budget.status).toBe("budget-exceeded");
  const cancel = new CaveGenerator({ seed: 0, width: 32, height: 32 });
  cancel.step(10);
  cancel.cancel();
  expect(cancel.generate()).toBeNull();
  expect(cancel.status).toBe("cancelled");
  for (const wallProbability of [NaN, Infinity, -1, 2])
    expect(
      () =>
        new CaveGenerator({ seed: 0, width: 20, height: 20, wallProbability }),
    ).toThrow("wallProbability");
});
