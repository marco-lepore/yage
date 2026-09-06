import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import {
  emptyLevelDocument,
  formatLevel,
  readLevel,
} from "@yagejs/level/document";
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
 * Why a level file was not created.
 *
 * `not-configured` covers every path the service will not write: one that
 * leaves the root, and one no configured glob matches. `not-found` and
 * `unreadable` describe the source a duplicate copies, so a create never
 * answers them.
 */
export type CreateLevelFailure =
  | "exists"
  | "not-configured"
  | "not-found"
  | "unreadable"
  | "write-failed";

export type CreateLevelResult =
  | {
      readonly ok: true;
      readonly document: LevelDocument;
      readonly diskRevision: string;
    }
  | { readonly ok: false; readonly reason: CreateLevelFailure };

export type DeleteLevelResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "not-configured" | "not-found" | "write-failed";
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
   * Which layer set a level belongs to: the index of the first configured
   * glob that both matches its path and named a layers module. Undefined when
   * no such glob matches, which is every project that declared no layers.
   */
  layerSetOf(path: string): number | undefined;
  /**
   * The directories a new level can be written to: the fixed leading segments
   * of each configured glob, deduplicated, in config order, keeping the ones a
   * level file directly inside them matches a glob. `""` is the root itself,
   * which is what a glob that starts with a wildcard answers.
   *
   * It is where a dialog offers to put a new file. The path it ends up asking
   * for is still matched against the globs like any other.
   */
  levelDirectories(): readonly string[];
  /**
   * Write a level holding nothing at a path no file holds yet.
   *
   * The path must be one of the configured levels, and an existing file is
   * never replaced — a level is created once, and a mistyped name that lands
   * on a level someone built is refused rather than emptied.
   */
  createLevel(path: string, levelId: string): Promise<CreateLevelResult>;
  /**
   * Copy one level to another path under a new level id.
   *
   * The document is otherwise unchanged: placement ids and the references
   * between them are scoped to one document, so a verbatim copy is consistent
   * on its own.
   */
  duplicateLevel(
    sourcePath: string,
    path: string,
    levelId: string,
  ): Promise<CreateLevelResult>;
  /** Remove one level file. Nothing else on disk is touched. */
  deleteLevel(path: string): Promise<DeleteLevelResult>;
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
  /**
   * Level globs, relative to the root, in config order. `layerSet` is the
   * index of the layer set the editor page imported for that glob, reported by
   * `layerSetOf` for every level the glob matches.
   */
  readonly levels: readonly ConfiguredLevelGlob[];
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

/** One configured level glob, and the layer set it names, if any. */
export interface ConfiguredLevelGlob {
  readonly glob: string;
  readonly layerSet?: number | undefined;
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

/** A sibling of the file being written that no other write in here names. */
function temporaryPath(absolute: string): string {
  return `${absolute}.${process.pid}.${(temporaryCounter += 1)}.tmp`;
}

/**
 * Glob syntax. A segment carrying any of these matches more than the text it
 * holds, so it names no one directory — and neither does anything after it.
 */
const GLOB_SYNTAX = /[*?[\]{}!()+@]/;

/**
 * The name a directory is tested with before it is offered: what a dialog
 * would ask for in it, since a level file is what the offer is about.
 */
const PROBE_LEVEL = "level.yage-level.json";

/**
 * The fixed directory a glob's matches live under: every leading segment that
 * names itself. `levels/*.yage-level.json` answers `"levels"`, and a glob
 * whose first segment is a pattern answers `""`, the root.
 */
function staticDirectory(glob: string): string {
  const segments = glob.split("/");
  const fixed: string[] = [];
  // The last segment names the file rather than a directory to write it in.
  for (const segment of segments.slice(0, -1)) {
    if (GLOB_SYNTAX.test(segment)) break;
    fixed.push(segment);
  }
  return fixed.join("/");
}

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
  const matches = picomatch(options.levels.map((level) => level.glob));
  // One matcher per glob that names a layer set, so a draft can say which set
  // its level was authored against. Globs that named none are left out rather
  // than ending the search, so a level matching both a bare glob and a glob
  // with layers is authored against the layers. Among the globs that name a
  // set the first match wins, which makes a narrower one listed first an
  // override of a broader one after it.
  const layerSets = options.levels
    .filter((level) => level.layerSet !== undefined)
    .map((level) => ({
      matches: picomatch(level.glob),
      layerSet: level.layerSet as number,
    }));
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

  // A glob's fixed part is not always somewhere a level may go:
  // `extra/{a,b}/*.yage-level.json` names `extra`, where every create is
  // refused. Only a directory a level file in it would be matched in is
  // offered.
  const directories = [
    ...new Set(options.levels.map((level) => staticDirectory(level.glob))),
  ].filter((directory) =>
    matches(directory === "" ? PROBE_LEVEL : `${directory}/${PROBE_LEVEL}`),
  );

  /**
   * Write a document to a path no file holds yet.
   *
   * The bytes go to a temporary sibling and the path is claimed by linking the
   * sibling to it, which fails with EEXIST when a file is already there. So a
   * reader never sees half a level, two creates of one name cannot both win,
   * and a level someone built is never emptied by a mistyped one. A rename
   * would replace that file rather than refuse the create.
   *
   * The directories on the way are made, so a project whose configured level
   * directory holds nothing yet can still be given its first level. They are
   * inside the root: the path was resolved before this was called.
   */
  async function createFile(
    absolute: string,
    document: LevelDocument,
  ): Promise<CreateLevelResult> {
    const canonical = formatLevel(document);
    const temporary = temporaryPath(absolute);
    try {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(temporary, canonical, "utf8");
      await link(temporary, absolute);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return { ok: false, reason: "exists" };
      }
      return { ok: false, reason: "write-failed" };
    }
    // The link is the file now; the sibling was only how it got its bytes.
    await unlink(temporary).catch(() => undefined);
    return {
      ok: true,
      document,
      diskRevision: hashBytes(Buffer.from(canonical, "utf8")),
    };
  }

  const service: LevelFileService = {
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

    layerSetOf(path) {
      return layerSets.find((entry) => entry.matches(path))?.layerSet;
    },

    levelDirectories() {
      return directories;
    },

    async createLevel(path, levelId) {
      const resolved = await resolveLevelPath(rules, path);
      if (!resolved.ok) return { ok: false, reason: "not-configured" };
      return await createFile(resolved.absolute, emptyLevelDocument(levelId));
    },

    async duplicateLevel(sourcePath, path, levelId) {
      const resolved = await resolveLevelPath(rules, path);
      if (!resolved.ok) return { ok: false, reason: "not-configured" };
      const source = await service.readLevel(sourcePath);
      if (!source.ok)
        return { ok: false, reason: SOURCE_FAILURES[source.reason] };
      if (!source.structural.ok) return { ok: false, reason: "unreadable" };
      return await createFile(resolved.absolute, {
        ...source.structural.document,
        id: levelId,
      });
    },

    async deleteLevel(path) {
      const resolved = await resolveLevelPath(rules, path);
      if (!resolved.ok) return { ok: false, reason: "not-configured" };
      try {
        await unlink(resolved.absolute);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return {
          ok: false,
          reason: code === "ENOENT" ? "not-found" : "write-failed",
        };
      }
      return { ok: true };
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
      // and a failed write leaves the old one exactly as it was. The rename
      // replaces the file, which is what a save is for.
      const temporary = temporaryPath(resolved.absolute);
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

  return service;
}

/** What a duplicate answers when the level it was told to copy is not there. */
const SOURCE_FAILURES = {
  "not-found": "not-found",
  "outside-roots": "not-configured",
  unreadable: "unreadable",
} as const satisfies Record<
  Extract<ReadLevelResult, { ok: false }>["reason"],
  CreateLevelFailure
>;

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
