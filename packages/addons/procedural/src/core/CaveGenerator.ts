import { createRandomService } from "@yagejs/core";
import { GenerationSearch } from "./GenerationSearch.js";
import { assertInteger, direction, fail, freezeCopy } from "./geometry.js";
import type { CaveOptions, TileMap } from "./types.js";

/** Cellular cave generation. Keeps the largest connected floor area and a closed boundary. */
export class CaveGenerator extends GenerationSearch<TileMap> {
  readonly options: CaveOptions;
  constructor(options: CaveOptions) {
    super(options);
    assertInteger("CaveGenerator width", options.width, 3, 256);
    assertInteger("CaveGenerator height", options.height, 3, 256);
    assertInteger("CaveGenerator iterations", options.iterations ?? 4, 0, 16);
    const p = options.wallProbability ?? 0.45;
    if (!Number.isFinite(p) || p < 0 || p > 1)
      fail(
        `CaveGenerator wallProbability: finite number in [0, 1] required, got ${p}`,
      );
    this.options = freezeCopy(options);
  }
  protected *run(): Generator<void, TileMap> {
    const { width, height } = this.options,
      random = createRandomService(this.seed);
    let cells = Array.from({ length: height }, () =>
      Array<string>(width).fill("#"),
    );
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        cells[y]![x] =
          random.float() < (this.options.wallProbability ?? 0.45) ? "#" : ".";
        yield;
      }
    for (let pass = 0; pass < (this.options.iterations ?? 4); pass++) {
      const next = cells.map((row) => [...row]);
      for (let y = 1; y < height - 1; y++)
        for (let x = 1; x < width - 1; x++) {
          let walls = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if ((dx !== 0 || dy !== 0) && cells[y + dy]![x + dx] === "#")
                walls++;
          next[y]![x] = walls >= 5 ? "#" : walls <= 3 ? "." : cells[y]![x]!;
          yield;
        }
      cells = next;
    }
    const visited = new Set<number>();
    let largest: number[] = [];
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        yield;
        const start = y * width + x;
        if (cells[y]![x] !== "." || visited.has(start)) continue;
        const queue = [start];
        visited.add(start);
        for (let i = 0; i < queue.length; i++) {
          const p = queue[i]!,
            px = p % width,
            py = Math.floor(p / width);
          for (const d of Object.values(direction)) {
            const nx = px + d.x,
              ny = py + d.y,
              key = ny * width + nx;
            if (cells[ny]?.[nx] === "." && !visited.has(key)) {
              visited.add(key);
              queue.push(key);
            }
          }
          yield;
        }
        if (queue.length > largest.length) largest = queue;
      }
    if (!largest.length)
      largest = [Math.floor(height / 2) * width + Math.floor(width / 2)];
    const retained = new Set(largest);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        cells[y]![x] = retained.has(y * width + x) ? "." : "#";
        yield;
      }
    return { origin: { x: 0, y: 0 }, cells: cells.map((row) => row.join("")) };
  }
}
