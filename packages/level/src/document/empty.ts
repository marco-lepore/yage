import type { LevelDocument } from "./types.js";

/**
 * A level holding no placements, at the format version this package writes.
 *
 * What a tool creates a level file from: `formatLevel` turns it into the
 * bytes, and reading those bytes back gives this document again.
 */
export function emptyLevelDocument(id: string): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id,
    metadata: {},
    entities: [],
    extensions: {},
  };
}
