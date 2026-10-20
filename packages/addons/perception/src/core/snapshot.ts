import type { PerceptionSnapshot } from "./types.js";
import { finite, identifier, point } from "./validation.js";

/** Validate and copy before any target resolver can mutate the caller's data. */
export function prepareSnapshot(
  snapshot: PerceptionSnapshot,
): PerceptionSnapshot {
  if (snapshot?.version !== 1)
    throw new Error(
      `PerceptionMemory.restore: unsupported version ${String(snapshot?.version)}`,
    );
  if (!Array.isArray(snapshot.records))
    throw new Error("PerceptionMemory.restore: records must be an array");
  const ids = new Set<string>();
  const records = snapshot.records.map((record) => {
    if (!record || typeof record !== "object")
      throw new Error(
        "PerceptionMemory.restore: each record must be an object",
      );
    identifier(record.id, "PerceptionMemory.restore");
    if (ids.has(record.id))
      throw new Error(`PerceptionMemory.restore: duplicate id ${record.id}`);
    ids.add(record.id);
    const lastSeenAge = finite(
      record.lastSeenAge,
      "PerceptionMemory.restore lastSeenAge",
      0,
    );
    const firstSeenAge = finite(
      record.firstSeenAge,
      "PerceptionMemory.restore firstSeenAge",
      lastSeenAge,
    );
    const lostAge =
      record.lostAge === null
        ? null
        : finite(
            record.lostAge,
            "PerceptionMemory.restore lostAge",
            0,
            lastSeenAge,
          );
    if (!record.lastPosition || typeof record.lastPosition !== "object")
      throw new Error("PerceptionMemory.restore: lastPosition must be a point");
    return Object.freeze({
      id: record.id,
      firstSeenAge,
      lastSeenAge,
      lostAge,
      lastPosition: point(
        record.lastPosition,
        "PerceptionMemory.restore position",
      ),
      visibility: finite(
        record.visibility,
        "PerceptionMemory.restore visibility",
        0,
        1,
      ),
    });
  });
  return Object.freeze({ version: 1, records: Object.freeze(records) });
}
