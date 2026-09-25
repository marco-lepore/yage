/**
 * `loadYarn` — Yarn Spinner files in, a playable dialogue script out. Takes one
 * `.yarn` source or a whole folder's files (a `.yarnproject`, its `.yarn`
 * files, and its localisation CSVs), compiles every node into one script, and
 * collects the `#line:` strings into per-locale catalogs.
 */

import { loadScript } from "../canonical.js";
import type { LoadedScript, SpeakerDef } from "../../types.js";
import { compileYarn, type YarnLineString } from "./compile.js";
import {
  dirname,
  globMatcher,
  normalizePath,
  parseCsv,
  parseLenientJson,
  resolvePath,
  stem,
} from "./files.js";
import { DialogueYarnError, parseYarn } from "./parse.js";
import { convertTranslatedText, splitCharacter } from "./text.js";

export interface YarnOptions {
  /**
   * The script id (what `DialogueStartedEvent` / `DialogueEndedEvent` report as
   * `scriptId`). Default: the `.yarnproject` file's name, else the `.yarn` file's
   * name when there is one, else `"yarn"`.
   */
  readonly id?: string | undefined;
  /**
   * Speaker details by character name — the name before the `:` on a line.
   * Every character gets a speaker whose display name is that name; an entry
   * here adds a nameplate `color`, an `avatar`, or a translatable `name`.
   */
  readonly speakers?: Readonly<Record<string, Partial<SpeakerDef>>> | undefined;
}

/** Line catalogs by locale, each `#line:` id → text. */
export type YarnCatalogs = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

/**
 * A compiled Yarn project: a validated dialogue script with every node, plus
 * its line catalogs. Play it like any script, picking the node to begin at:
 * `controller.play(yarn, { start: "Shopkeeper" })`. Without `start` it begins
 * at the node titled `Start`, else the first node.
 */
export type YarnScript = LoadedScript & {
  /**
   * The `#line:` strings by locale: the base language from the `.yarn`
   * sources, plus each localisation the `.yarnproject` lists with a strings
   * table. Hand them to your localization, for example
   * `createLocalization({ locale, fallbackLocale: yarn.baseLanguage, catalogs: yarn.catalogs })`
   * from `@yagejs-addons/i18n`.
   */
  readonly catalogs: YarnCatalogs;
  /** The project's `baseLanguage`, or `"en"` without a `.yarnproject`. */
  readonly baseLanguage: string;
};

/** A `.yarnproject` file, after defaults. */
interface YarnProject {
  readonly path: string;
  readonly sourceFiles: readonly string[];
  readonly excludeFiles: readonly string[];
  readonly baseLanguage: string;
  readonly localisation: Readonly<
    Record<string, { readonly strings?: string }>
  >;
}

/** The newest `projectFileVersion` this loader reads. */
const PROJECT_VERSION = 4;

/**
 * Compile Yarn Spinner source into a playable, validated script.
 *
 * Pass one file's source, or a map of file path → text — typically a folder
 * read with Vite's `import.meta.glob` (its values are typed `unknown`; each
 * must be the file's text):
 *
 * ```ts
 * const yarn = loadYarn(
 *   import.meta.glob("./dialogue/*", { query: "?raw", import: "default", eager: true }),
 * );
 * ```
 *
 * With a `.yarnproject` among the files, its `sourceFiles` / `excludeFiles`
 * pick the `.yarn` files (relative to the project file) and its `localisation`
 * strings tables become {@link YarnScript.catalogs}. Without one, every `.yarn`
 * file is compiled. Other files are ignored.
 *
 * Throws `DialogueYarnError` (a `DialogueScriptError`, with `file` and `line`)
 * on a syntax or reference error.
 */
export function loadYarn(
  source: string | Readonly<Record<string, unknown>>,
  options: YarnOptions = {},
): YarnScript {
  const files = new Map<string, string>();
  if (typeof source === "string") {
    files.set("<yarn>", source);
  } else {
    for (const [path, text] of Object.entries(source)) {
      if (typeof text !== "string") {
        throw new DialogueYarnError(
          `expected the file's text, got ${typeof text} (with import.meta.glob, pass { query: "?raw", import: "default" })`,
          path,
          1,
        );
      }
      files.set(normalizePath(path), text);
    }
  }

  const project = findProject(files);
  const sources = [...files].filter(([path]) =>
    project
      ? inProject(project, path)
      : path === "<yarn>" || /\.yarn$/i.test(path),
  );
  if (sources.length === 0) {
    throw new DialogueYarnError(
      project
        ? `no .yarn files match the project's sourceFiles (${project.sourceFiles.join(", ")})`
        : "no .yarn files given",
      project?.path ?? "<yarn>",
      1,
    );
  }

  const id =
    options.id ??
    (project
      ? stem(project.path)
      : sources.length === 1 && sources[0]![0] !== "<yarn>"
        ? stem(sources[0]![0])
        : "yarn");
  const compiled = compileYarn(
    sources.map(([path, text]) => parseYarn(text, path)),
    { id, speakers: options.speakers },
  );

  const baseLanguage = project?.baseLanguage ?? "en";
  const catalogs: Record<string, Readonly<Record<string, string>>> = {
    [baseLanguage]: Object.fromEntries(
      [...compiled.strings].map(([lineId, str]) => [lineId, str.text]),
    ),
  };
  for (const [locale, entry] of Object.entries(project?.localisation ?? {})) {
    if (locale === baseLanguage || entry.strings === undefined) continue;
    catalogs[locale] = readStrings(
      project!,
      locale,
      entry.strings,
      files,
      compiled.strings,
    );
  }

  // loadScript keeps fields it doesn't read, so the catalogs ride along on
  // the frozen script it returns.
  const withCatalogs = { ...compiled.script, catalogs, baseLanguage };
  return loadScript(withCatalogs) as YarnScript;
}

/** The one `.yarnproject` among the files, parsed, or undefined. */
function findProject(
  files: ReadonlyMap<string, string>,
): YarnProject | undefined {
  const found = [...files.keys()].filter((p) => /\.yarnproject$/i.test(p));
  if (found.length === 0) return undefined;
  if (found.length > 1) {
    throw new DialogueYarnError(
      `found more than one .yarnproject (${found.join(", ")}); pass one project's files at a time`,
      found[1]!,
      1,
    );
  }
  const path = found[0]!;
  let raw: unknown;
  try {
    raw = parseLenientJson(files.get(path)!);
  } catch (e) {
    throw new DialogueYarnError(
      `not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      path,
      1,
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DialogueYarnError("expected a JSON object", path, 1);
  }
  // Yarn Spinner matches property names without regard to case.
  const get = (key: string): unknown =>
    Object.entries(raw as Record<string, unknown>).find(
      ([k]) => k.toLowerCase() === key.toLowerCase(),
    )?.[1];
  const fail = (message: string): never => {
    throw new DialogueYarnError(message, path, 1);
  };

  const version = get("projectFileVersion");
  if (typeof version !== "number" || version < 2) {
    fail(`projectFileVersion must be 2, 3, or ${PROJECT_VERSION}`);
  } else if (version > PROJECT_VERSION) {
    fail(
      `projectFileVersion ${version} is newer than this loader reads (${PROJECT_VERSION})`,
    );
  }
  const list = (
    key: string,
    fallback: readonly string[],
  ): readonly string[] => {
    const value = get(key);
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      return fail(`${key} must be a list of glob strings`);
    }
    return value as string[];
  };
  const baseLanguage = get("baseLanguage") ?? "en";
  if (typeof baseLanguage !== "string" || baseLanguage === "") {
    fail('baseLanguage must be a language tag such as "en"');
  }
  const localisation: Record<string, { strings?: string }> = {};
  const loc = get("localisation") ?? {};
  if (typeof loc !== "object" || loc === null || Array.isArray(loc)) {
    fail("localisation must be an object keyed by language");
  }
  for (const [locale, entry] of Object.entries(
    loc as Record<string, unknown>,
  )) {
    const strings = (entry as { strings?: unknown } | null)?.strings;
    if (
      strings !== undefined &&
      strings !== null &&
      typeof strings !== "string"
    ) {
      fail(`localisation.${locale}.strings must be a file path`);
    }
    localisation[locale] = typeof strings === "string" ? { strings } : {};
  }
  return {
    path,
    sourceFiles: list("sourceFiles", ["**/*.yarn"]),
    excludeFiles: list("excludeFiles", []),
    baseLanguage: baseLanguage as string,
    localisation,
  };
}

/** Whether a `.yarn` file is one of the project's sources. */
function inProject(project: YarnProject, path: string): boolean {
  if (!/\.yarn$/i.test(path)) return false;
  const dir = dirname(project.path);
  const matches = (glob: string): boolean =>
    globMatcher(resolvePath(dir, glob)).test(path);
  return (
    project.sourceFiles.some(matches) && !project.excludeFiles.some(matches)
  );
}

/**
 * A localisation strings table → that locale's catalog. Rows whose id the
 * project doesn't use, or whose text is empty, are left out (the base text
 * shows instead). A translated line drops its `Character:` prefix when the
 * source line had one, since the speaker is shown separately.
 */
function readStrings(
  project: YarnProject,
  locale: string,
  relative: string,
  files: ReadonlyMap<string, string>,
  strings: ReadonlyMap<string, YarnLineString>,
): Record<string, string> {
  const wanted = resolvePath(dirname(project.path), relative);
  const path = [...files.keys()].find(
    (p) => p.toLowerCase() === wanted.toLowerCase(),
  );
  if (path === undefined) {
    throw new DialogueYarnError(
      `localisation "${locale}" reads its strings from ${wanted}, which is not among the files passed to loadYarn (include .csv files in the import.meta.glob pattern)`,
      project.path,
      1,
    );
  }
  const rows = parseCsv(files.get(path)!);
  if (rows.length > 0 && (!("id" in rows[0]!) || !("text" in rows[0]!))) {
    throw new DialogueYarnError(
      `a strings table needs "id" and "text" columns`,
      path,
      1,
    );
  }
  const catalog: Record<string, string> = {};
  for (const row of rows) {
    const lineId = row["id"]!.trim();
    const source = strings.get(lineId);
    const raw = row["text"]!;
    if (!source || raw.trim() === "") continue;
    const text = source.hasCharacter
      ? splitCharacter(raw.trim()).text
      : raw.trim();
    catalog[lineId] = convertTranslatedText(text);
  }
  return catalog;
}
