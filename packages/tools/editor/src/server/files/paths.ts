import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, sep } from "node:path";

/**
 * A project-relative level path, resolved to a real absolute path inside the
 * writable root, or refused.
 */
export type PathResolution =
  | { ok: true; absolute: string }
  | { ok: false; reason: "outside-roots" };

export interface LevelPathRules {
  /** Real path of the writable root. Every resolution stays under it. */
  readonly realRoot: string;
  /** Whether a root-relative POSIX path is one of the configured levels. */
  readonly isConfiguredLevel: (path: string) => boolean;
}

/**
 * Resolve a path the browser sent.
 *
 * Three gates, in order: the text of the path, the configured level patterns,
 * and the real filesystem. The last one is what a textual check cannot do — a
 * symlink inside the root can point anywhere — so both the target and its
 * nearest existing ancestor are resolved through `realpath` before the path is
 * handed back. The ancestor matters for a file that does not exist yet: a
 * symlinked directory would otherwise pass on the way to a write.
 */
export async function resolveLevelPath(
  rules: LevelPathRules,
  path: string,
): Promise<PathResolution> {
  if (typeof path !== "string" || path.length === 0) return REFUSED;
  if (path.includes("\\") || path.includes("\0")) return REFUSED;
  if (isAbsolute(path)) return REFUSED;
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return REFUSED;
  if (!rules.isConfiguredLevel(path)) return REFUSED;

  const absolute = join(rules.realRoot, ...segments);
  const ancestor = await nearestExistingAncestor(absolute);
  if (!isInside(rules.realRoot, ancestor)) return REFUSED;
  try {
    const real = await realpath(absolute);
    return isInside(rules.realRoot, real)
      ? { ok: true, absolute: real }
      : REFUSED;
  } catch {
    // No such file yet. Its ancestor is inside the root, so the write lands
    // inside it too.
    return { ok: true, absolute };
  }
}

const REFUSED: PathResolution = { ok: false, reason: "outside-roots" };

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

async function nearestExistingAncestor(absolute: string): Promise<string> {
  let candidate = dirname(absolute);
  for (;;) {
    try {
      return await realpath(candidate);
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return candidate;
      candidate = parent;
    }
  }
}
