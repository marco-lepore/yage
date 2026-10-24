import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { homedir } from "node:os";
import { workDir } from "./paths.js";
import {
  packLocalPackages,
  pointAtTarballs,
  type LocalTarball,
} from "./localPackages.mjs";

/**
 * Where the packager keeps the Electron builds it downloads. Inside the
 * suite's own work directory, so a run leaves nothing in the user's caches.
 */
export const electronCacheRoot = resolve(workDir, "electron-cache");

/**
 * Copy an Electron build the machine already downloaded into the suite's
 * cache, so the first package does not fetch 130 MB again. A cache that has
 * none is left for the packager to fill.
 */
export function seedElectronCache(): void {
  mkdirSync(electronCacheRoot, { recursive: true });
  const user = resolve(homedir(), "Library/Caches/electron");
  if (!existsSync(user)) return;
  for (const entry of readdirSync(user, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const from = resolve(user, entry.name);
    for (const file of readdirSync(from)) {
      if (!file.endsWith(".zip")) continue;
      const into = resolve(electronCacheRoot, entry.name);
      if (existsSync(resolve(into, file))) continue;
      mkdirSync(into, { recursive: true });
      cpSync(resolve(from, file), resolve(into, file));
    }
  }
}

/**
 * Run a command inside a project and return what it printed.
 *
 * Three parts of the inherited environment would otherwise reach it: npm
 * exports the repository as every nested command's project, a bundler run in
 * this process leaves `NODE_ENV` at `production`, which makes npm skip the
 * build tools, and the runner's own Node options are not the project's. The
 * project's executables go on the path instead, which is where a tool's hook
 * scripts look for them.
 */
export function npmRun(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
): string {
  const inherited = Object.fromEntries(
    Object.entries(process.env as Record<string, string>).filter(
      ([name]) =>
        !name.startsWith("npm_") &&
        name !== "NODE_OPTIONS" &&
        name !== "NODE_ENV",
    ),
  );
  return execFileSync(command, [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    env: {
      ...inherited,
      PATH: `${resolve(cwd, "node_modules/.bin")}:${inherited["PATH"] ?? ""}`,
      // The packager downloads into the suite's own cache; nothing installs
      // an Electron binary beside the project.
      ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
      ...env,
    },
  });
}

/** Install a project against this repository's packages rather than the registry. */
export function installAgainstThisRepository(
  projectDir: string,
  names?: readonly string[],
): Map<string, LocalTarball> {
  const packs = resolve(workDir, "packs");
  mkdirSync(packs, { recursive: true });
  const manifestFile = resolve(projectDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<
    string,
    unknown
  >;
  const declared = [
    ...Object.keys((manifest.dependencies as object | undefined) ?? {}),
    ...Object.keys((manifest.devDependencies as object | undefined) ?? {}),
  ];
  const tarballs = packLocalPackages({
    names: names ?? declared,
    destination: packs,
  });
  const overrides = pointAtTarballs(manifest, tarballs);
  manifest.overrides = {
    ...(manifest.overrides as Record<string, string> | undefined),
    ...overrides,
  };
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  npmRun("npm", ["install", "--no-audit", "--no-fund"], projectDir);
  return tarballs;
}

/** The packaged app a Forge run left under `out/`. */
export function packagedApp(projectDir: string): string {
  const out = resolve(projectDir, "out");
  const directory = readdirSync(out, { withFileTypes: true }).find(
    (entry) => entry.isDirectory() && entry.name.split("-").length >= 3,
  );
  if (directory === undefined) {
    throw new Error(`packagedApp: ${out} holds no packaged app.`);
  }
  const dir = resolve(out, directory.name);
  const bundle = readdirSync(dir).find((entry) => entry.endsWith(".app"));
  if (bundle === undefined) {
    throw new Error(`packagedApp: ${dir} holds no app bundle.`);
  }
  return resolve(dir, bundle);
}

/** The executable inside a packaged macOS app. */
export function packagedExecutable(app: string): string {
  const macOs = resolve(app, "Contents/MacOS");
  const [executable] = readdirSync(macOs);
  if (executable === undefined) {
    throw new Error(`packagedExecutable: ${macOs} is empty.`);
  }
  return resolve(macOs, executable);
}

/** The name a packaged app carries, for a message that names it. */
export function appName(app: string): string {
  return basename(app, ".app");
}
