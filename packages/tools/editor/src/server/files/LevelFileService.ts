import { createHash } from "node:crypto";
import {
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import { formatLevel, readLevel } from "@yagejs/level/document";
import type { LevelDocument, StructuralResult } from "@yagejs/level/document";
import type {
  AssetListing,
  LevelSummary,
} from "../../shared/protocol/index.js";
import { resolveLevelPath, type LevelPathRules } from "./paths.js";

export type ReadLevelResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly structural: StructuralResult;
      readonly diskRevision: string;
    }
  | {
      readonly ok: false;
      readonly reason: "not-found" | "outside-roots" | "unreadable";
    };

export type WriteLevelResult =
  | {
      readonly ok: true;
      readonly diskRevision: string;
      readonly contentHash: string;
    }
  | {
      readonly ok: false;
      readonly reason: "stale-disk" | "outside-roots" | "write-failed";
    };

/**
 * The only code that touches project level files and asset listings.
 *
 * Every path it accepts is confined to one writable root and matched against
 * the configured level patterns, and every write is compare-and-swap against
 * the revision the caller last saw, through a temporary sibling and a rename.
 * Nothing else on the server opens a file.
 */
export interface LevelFileService {
  listLevels(): Promise<readonly LevelSummary[]>;
  /**
   * The project files the configured asset globs match, as the POSIX paths the
   * browser fetches them by, in sorted order. That is the shape a level stores,
   * so a picked path goes into `params` unchanged. A file under `publicDir` is
   * reported without that prefix, because Vite serves the directory's contents
   * at the server root, and two files that answer to one address are one entry.
   *
   * Confinement is the walk itself: `readdir` reports a symlink as neither a
   * file nor a directory, so the listing never descends out of the root and
   * never names a link's target. Nothing resolves a path here, because no asset
   * path arrives from the browser — the picker writes what it was given straight
   * into a placement's `params`.
   */
  listAssets(): Promise<AssetListing>;
  readLevel(path: string): Promise<ReadLevelResult>;
  writeLevel(
    path: string,
    document: LevelDocument,
    expectedDiskRevision: string,
  ): Promise<WriteLevelResult>;
  /**
   * Hash of a document's canonical form. This is what the dirty indicator
   * compares; a disk revision hashes the bytes a file actually holds, which
   * differ when someone wrote the file by hand.
   */
  hashCanonical(document: LevelDocument): string;
}

export interface LevelFileServiceOptions {
  /** The one writable root, normally the Vite root. */
  readonly root: string;
  /** Level globs, relative to the root, from the editor config. */
  readonly levels: readonly string[];
  /** Asset globs, relative to the root. Empty lists nothing. */
  readonly assets: readonly string[];
  /**
   * The project's `publicDir`, absolute, as Vite resolved it — `""` when the
   * project turned it off. Vite serves what is inside it at the server root, so
   * an asset there is listed without the prefix the glob matched it by.
   */
  readonly publicDir?: string | undefined;
  /**
   * The most paths one listing carries, past which it reports `truncated`.
   * Defaults to {@link MAX_LISTED_ASSETS}; lowered by tests, and raisable by a
   * host that wants a bigger list.
   */
  readonly maxAssets?: number | undefined;
}

/** Directories a project walk never descends into. */
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist"]);

/**
 * How many asset paths one listing carries. It bounds the response, not the
 * walk: the walk finishes and the list is sorted before it is cut, so two runs
 * over the same tree report the same paths.
 */
const MAX_LISTED_ASSETS = 5000;

/** Makes each temporary write name unique within this process. */
let temporaryCounter = 0;

/**
 * The leading segments Vite drops when it serves a project file, with a
 * trailing slash — `"public/"` for the default `publicDir`.
 *
 * Undefined when there is nothing to drop: the project turned `publicDir` off,
 * moved it outside the root where the walk cannot reach it anyway, or made it
 * the root itself. In each of those a matched path is already the path the
 * browser fetches.
 */
function servedPrefix(
  root: string,
  publicDir: string | undefined,
): string | undefined {
  if (publicDir === undefined || publicDir === "") return undefined;
  const inside = relative(resolve(root), resolve(publicDir));
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    return undefined;
  }
  return `${inside.split(sep).join("/")}/`;
}

export async function createLevelFileService(
  options: LevelFileServiceOptions,
): Promise<LevelFileService> {
  const realRoot = await realpath(resolve(options.root));
  const matches = picomatch([...options.levels]);
  const assetMatches =
    options.assets.length > 0 ? picomatch([...options.assets]) : undefined;
  const publicPrefix = servedPrefix(options.root, options.publicDir);
  const rules: LevelPathRules = {
    realRoot,
    isConfiguredLevel: (path) => matches(path),
  };

  /**
   * Every file under the root the matcher accepts, as root-relative POSIX
   * paths. `readdir` reports a symlink as neither a file nor a directory, so
   * the walk cannot descend out of the root or name a link's target.
   */
  async function walk(
    directory: string,
    accepts: (path: string) => boolean,
    found: string[],
  ): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        await walk(absolute, accepts, found);
      } else if (entry.isFile()) {
        const relative = absolute
          .slice(realRoot.length + 1)
          .split(sep)
          .join("/");
        if (accepts(relative)) found.push(relative);
      }
    }
  }

  return {
    async listLevels() {
      const found: string[] = [];
      await walk(realRoot, matches, found);
      found.sort();
      const summaries: LevelSummary[] = [];
      for (const path of found) {
        const bytes = await readFile(join(realRoot, ...path.split("/")));
        summaries.push({ path, diskRevision: hashBytes(bytes) });
      }
      return summaries;
    },

    async listAssets() {
      if (assetMatches === undefined) return { paths: [], truncated: false };
      const found: string[] = [];
      await walk(realRoot, assetMatches, found);
      // A glob matches a file where it sits on disk, which is the tree the
      // config's author is looking at. What comes back is where the browser
      // fetches it, which is what a level stores — one segment shorter for
      // anything under `publicDir`.
      // Two files can share one address — `<root>/a.png` and
      // `<root>/public/a.png` are both fetched as `a.png`, and publicDir wins
      // — so the same string is offered once.
      const served =
        publicPrefix === undefined
          ? found
          : [
              ...new Set(
                found.map((path) =>
                  path.startsWith(publicPrefix)
                    ? path.slice(publicPrefix.length)
                    : path,
                ),
              ),
            ];
      served.sort();
      const max = options.maxAssets ?? MAX_LISTED_ASSETS;
      return { paths: served.slice(0, max), truncated: served.length > max };
    },

    async readLevel(path) {
      const resolved = await resolveLevelPath(rules, path);
      if (!resolved.ok) return { ok: false, reason: "outside-roots" };
      let bytes: Buffer;
      try {
        bytes = await readFile(resolved.absolute);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return {
          ok: false,
          reason: code === "ENOENT" ? "not-found" : "unreadable",
        };
      }
      const text = bytes.toString("utf8");
      return {
        ok: true,
        text,
        structural: readLevel(text),
        diskRevision: hashBytes(bytes),
      };
    },

    async writeLevel(path, document, expectedDiskRevision) {
      const resolved = await resolveLevelPath(rules, path);
      if (!resolved.ok) return { ok: false, reason: "outside-roots" };
      let current: string | null = null;
      try {
        current = hashBytes(await readFile(resolved.absolute));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          return { ok: false, reason: "write-failed" };
        }
      }
      if (current !== expectedDiskRevision) {
        return { ok: false, reason: "stale-disk" };
      }

      const canonical = formatLevel(document);
      const revision = hashBytes(Buffer.from(canonical, "utf8"));
      // A temporary sibling and a rename, so a reader never sees half a file
      // and a failed write leaves the old one exactly as it was.
      const suffix = `${process.pid}.${(temporaryCounter += 1)}`;
      const temporary = `${resolved.absolute}.${suffix}.tmp`;
      try {
        await writeFile(temporary, canonical, "utf8");
        await rename(temporary, resolved.absolute);
      } catch {
        await unlink(temporary).catch(() => undefined);
        return { ok: false, reason: "write-failed" };
      }
      return { ok: true, diskRevision: revision, contentHash: revision };
    },

    hashCanonical(document) {
      return hashBytes(Buffer.from(formatLevel(document), "utf8"));
    },
  };
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
