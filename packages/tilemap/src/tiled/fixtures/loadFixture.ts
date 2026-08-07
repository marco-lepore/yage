import { readFileSync } from "node:fs";
import type { TiledMapData } from "../types.js";

export function loadFixture(name: string): TiledMapData {
  const contents = readFileSync(new URL(name, import.meta.url), "utf8");
  return JSON.parse(contents) as TiledMapData;
}
