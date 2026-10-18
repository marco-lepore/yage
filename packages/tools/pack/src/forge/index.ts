import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  ForgeConfig,
  ForgePackagerOptions,
} from "@electron-forge/shared-types";
import { runCheck } from "../check.js";
import { RELEASE_FUSES, type FuseName } from "../fuses.js";
import { reportText } from "../report.js";
import { readIdentity, readManifest, WEB_DIRS } from "../project.js";
import { writeBuildRecord } from "../record.js";
import { HOST_PACKAGE } from "../types.js";

export { RELEASE_FUSES, type FuseName } from "../fuses.js";

/** The packager settings this configuration owns. */
const OWNED_PACKAGER_KEYS = ["asar", "appBundleId", "ignore"] as const;

export interface ElectronForgeOptions {
  /** The game's root. Default: the directory Forge runs in. */
  readonly root?: string;
  /** Packager settings beside YAGE's, such as an icon or signing options. */
  readonly packagerConfig?: Omit<
    ForgePackagerOptions,
    "asar" | "appBundleId" | "ignore"
  >;
  /** Default: a ZIP for macOS and Windows. */
  readonly makers?: ForgeConfig["makers"];
  /** Run after the fuses plugin. */
  readonly plugins?: ForgeConfig["plugins"];
  /** Each runs after YAGE's hook of the same name. */
  readonly hooks?: ForgeConfig["hooks"];
  /** Project paths kept in the archive beside the shell and the web build. */
  readonly include?: readonly string[];
  /** Packages whose production closure is kept in the archive as well. */
  readonly runtimeDependencies?: readonly string[];
}

/**
 * A complete Electron Forge configuration for a YAGE game: export it from
 * `forge.config.cjs`.
 *
 * The app's identity comes from the game's `package.json`, the archive holds
 * the shell, the Electron web build and the packages the shell loads at run
 * time, and every package carries the release fuses. Each build checks the
 * game's settings and writes a record of what went into it.
 */
export function electronForgeConfig(
  options: ElectronForgeOptions = {},
): ForgeConfig {
  const root = path.resolve(options.root ?? process.cwd());
  const identity = readIdentity(root, "electronForgeConfig");
  const packagerConfig = options.packagerConfig ?? {};
  for (const key of OWNED_PACKAGER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(packagerConfig, key)) {
      throw new Error(
        `electronForgeConfig: packagerConfig.${key} is set by @yagejs-tools/pack; remove it.`,
      );
    }
  }

  const main = readManifest(root)?.main;
  if (typeof main !== "string" || !existsSync(path.join(root, main))) {
    throw new Error(
      `electronForgeConfig: package.json "main" must name the shell's main script, got ${JSON.stringify(main)}.`,
    );
  }

  // Each entry is kept in its resolved form, so "assets/" and "data/./x" keep
  // the files they name.
  const include = (options.include ?? []).map((entry, index) => {
    const relative = path.relative(root, path.resolve(root, entry));
    if (
      path.isAbsolute(entry) ||
      relative === "" ||
      relative.startsWith("..")
    ) {
      throw new Error(
        `electronForgeConfig: include[${index}] must be a path inside the game, got ${JSON.stringify(entry)}.`,
      );
    }
    return relative;
  });

  // A packaged game always carries the host package's production closure.
  const closure = productionClosure(root, [
    HOST_PACKAGE.electron,
    ...(options.runtimeDependencies ?? []),
  ]);

  // A shell script at the game's root is kept by name; one in its own folder
  // keeps the folder, which is where a shell with more than one file sits.
  const mainDirectory = path.dirname(main);
  const kept = new Set<string>([
    "/package.json",
    posix(mainDirectory === "." ? main : mainDirectory),
    `/${WEB_DIRS.electron}`,
    ...include.map((entry) => posix(entry)),
    ...[...closure].map((name) => `/node_modules/${name}`),
  ]);

  /** Forge calls this for every project path, with a leading slash. */
  const ignore = (file: string): boolean => {
    if (file === "") return false;
    for (const entry of kept) {
      if (file === entry || file.startsWith(`${entry}/`)) return false;
      // A directory on the way to a kept path has to stay as well.
      if (entry.startsWith(`${file}/`)) return false;
    }
    return true;
  };

  /** The outputs of the package step, so the record names them all. */
  let packaged: readonly string[] = [];
  let recordFile = "";

  const yageHooks: ForgeConfig["hooks"] = {
    prePackage: async () => {
      const report = await runCheck({
        root,
        target: "electron",
        release: false,
      });
      if (!report.ok) throw new Error(reportText(report));
    },
    postPackage: async (config, result) => {
      const report = await runCheck({
        root,
        target: "electron",
        release: true,
        apps: result.outputPaths,
      });
      if (!report.ok) throw new Error(reportText(report));
      packaged = result.outputPaths;
      recordFile = path.join(
        path.resolve(root, config.outDir ?? "out"),
        "yage-build-electron.json",
      );
      await writeBuildRecord({
        root,
        target: "electron",
        profile: "release",
        artifacts: [...packaged],
        out: recordFile,
      });
    },
    postMake: async (_config, makeResults) => {
      if (recordFile !== "") {
        await writeBuildRecord({
          root,
          target: "electron",
          profile: "release",
          artifacts: [
            ...packaged,
            ...makeResults.flatMap((result) => result.artifacts),
          ],
          out: recordFile,
        });
      }
      return makeResults;
    },
  };

  const chained = chainHooks(yageHooks, options.hooks);
  return {
    packagerConfig: {
      ...packagerConfig,
      asar: true,
      appBundleId: identity.appId,
      ignore,
    },
    makers: options.makers ?? [
      {
        name: "@electron-forge/maker-zip",
        config: {},
        platforms: ["darwin", "win32"],
      },
    ],
    plugins: [fusesPlugin(root), ...(options.plugins ?? [])],
    ...(chained === undefined ? {} : { hooks: chained }),
  };
}

/** The fuses plugin, loaded from the game's own install. */
function fusesPlugin(
  root: string,
): NonNullable<ForgeConfig["plugins"]>[number] {
  const require = createRequire(path.join(root, "package.json"));
  const { FusesPlugin } = require("@electron-forge/plugin-fuses") as {
    FusesPlugin: new (config: Record<string, unknown>) => never;
  };
  const { FuseVersion, FuseV1Options } = require("@electron/fuses") as {
    FuseVersion: Record<string, string>;
    FuseV1Options: Record<FuseName, number>;
  };
  const config: Record<string | number, unknown> = {
    version: FuseVersion.V1,
  };
  for (const [name, value] of Object.entries(RELEASE_FUSES)) {
    config[FuseV1Options[name as FuseName]] = value;
  }
  return new FusesPlugin(config);
}

/**
 * The production-dependency closure of the named packages, as the game
 * installed them: what the shell loads once the app runs from its archive.
 */
function productionClosure(
  root: string,
  names: readonly string[],
): Set<string> {
  const found = new Set<string>();
  const queue = [...names];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (found.has(name)) continue;
    const manifest = path.join(
      root,
      "node_modules",
      ...name.split("/"),
      "package.json",
    );
    if (!existsSync(manifest)) {
      throw new Error(
        `electronForgeConfig: ${name} is not installed. Run npm install ${name}.`,
      );
    }
    found.add(name);
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    queue.push(...Object.keys(parsed.dependencies ?? {}));
  }
  return found;
}

/** A project path as Forge's ignore function spells it. */
function posix(entry: string): string {
  const normalized = entry
    .split(path.sep)
    .join("/")
    .replace(/^\.?\/?/, "");
  return `/${normalized}`;
}

/** The game's hooks run after YAGE's, with the same arguments. */
function chainHooks(
  own: ForgeConfig["hooks"],
  theirs: ForgeConfig["hooks"],
): ForgeConfig["hooks"] {
  if (theirs === undefined) return own;
  const merged: Record<string, unknown> = { ...own };
  for (const [name, hook] of Object.entries(theirs)) {
    const mine = (own as Record<string, unknown> | undefined)?.[name];
    merged[name] =
      mine === undefined
        ? hook
        : async (...args: unknown[]) => {
            const result = await (
              mine as (...a: unknown[]) => Promise<unknown>
            )(...args);
            // A hook that returns a value replaces the one its successor
            // reads, so `postMake` hands the game what YAGE wrote.
            const next =
              result === undefined ? args : [args[0], result, ...args.slice(2)];
            return (hook as (...a: unknown[]) => Promise<unknown>)(...next);
          };
  }
  return merged as ForgeConfig["hooks"];
}
