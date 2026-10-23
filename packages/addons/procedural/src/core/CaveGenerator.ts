import { GenerationSearch } from "./GenerationSearch.js";
import { direction } from "./geometry.js";
import { assertInteger, fail, freezeCopy } from "./internal.js";
import type { CaveOptions, TileMap } from "./types.js";

/**
 * Cellular cave on a closed boundary. Keeps only the largest connected floor
 * area; when no floor survives smoothing, the centre tile is the floor.
 */
export class CaveGenerator extends GenerationSearch<TileMap> {
  readonly options: CaveOptions;
  constructor(options: CaveOptions) {
    super(options);
    assertInteger("CaveGenerator width", options.width, 3);
    assertInteger("CaveGenerator height", options.height, 3);
    assertInteger("CaveGenerator iterations", options.iterations ?? 4, 0);
    assertInteger("CaveGenerator origin.x", options.origin?.x ?? 0, -Infinity);
    assertInteger("CaveGenerator origin.y", options.origin?.y ?? 0, -Infinity);
    const p = options.wallProbability ?? 0.45;
    if (!Number.isFinite(p) || p < 0 || p > 1)
      fail(
        `CaveGenerator wallProbability: number in [0, 1] required, got ${p}`,
      );
    this.options = freezeCopy(options);
  }
  protected *run(): Generator<void, TileMap> {
    const { width, height } = this.options;
    const wallProbability = this.options.wallProbability ?? 0.45;
    // Rows are allocated and copied one per operation, so a large cave
    // spreads its work across steps like the rest of the generation.
    let cells: string[][] = [];
    for (let y = 0; y < height; y++) {
      cells.push(Array<string>(width).fill("#"));
      yield;
    }
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        cells[y]![x] = this.random.float() < wallProbability ? "#" : ".";
        yield;
      }
    for (let pass = 0; pass < (this.options.iterations ?? 4); pass++) {
      const next: string[][] = [];
      for (const row of cells) {
        next.push([...row]);
        yield;
      }
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
          const px = queue[i]! % width,
            py = Math.floor(queue[i]! / width);
          for (const d of Object.values(direction)) {
            const key = (py + d.y) * width + px + d.x;
            if (cells[py + d.y]?.[px + d.x] === "." && !visited.has(key)) {
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
    const kept = new Set(largest);
    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
      let row = "";
      for (let x = 0; x < width; x++)
        row += kept.has(y * width + x) ? "." : "#";
      rows.push(row);
      yield;
    }
    return { origin: this.options.origin ?? { x: 0, y: 0 }, cells: rows };
  }
}
