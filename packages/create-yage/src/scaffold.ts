import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { TemplateId } from "./templates.js";
import type { FeatureId } from "./features.js";
import { FEATURES } from "./features.js";
import { copyTemplateDirectory, rewriteJson } from "./utils.js";

export interface ScaffoldOptions {
  targetDir: string;
  projectName: string;
  template: TemplateId;
  templatesRoot: string;
  /** Optional feature add-ons (see `features.ts`). */
  features?: readonly FeatureId[];
  /** If true, delete the target directory before copying (overwrite mode). */
  overwrite: boolean;
  install: boolean;
  git: boolean;
}

export interface ScaffoldResult {
  installSucceeded: boolean | null;
  gitSucceeded: boolean | null;
}

/**
 * Copies the chosen template into the target directory, patches package.json
 * with the project name, and optionally runs `npm install` + `git init`.
 * The caller is responsible for confirming with the user before overwriting.
 */
export async function scaffold(
  options: ScaffoldOptions,
): Promise<ScaffoldResult> {
  if (options.overwrite) {
    await rm(options.targetDir, { recursive: true, force: true });
  }

  const templateDir = join(options.templatesRoot, options.template);
  await copyTemplateDirectory(templateDir, options.targetDir);

  const features = options.features ?? [];
  await rewriteJson<PackageJson>(
    join(options.targetDir, "package.json"),
    (pkg) => applyFeaturesToPackageJson({ ...pkg, name: options.projectName }, features),
  );

  if (features.length > 0) {
    await rewriteJson<TsConfigJson>(
      join(options.targetDir, "tsconfig.json"),
      (cfg) => applyFeaturesToTsConfig(cfg, features),
    );
  }

  const installSucceeded = options.install
    ? await runCommand("npm", ["install"], options.targetDir)
    : null;

  const gitSucceeded = options.git
    ? await initGit(options.targetDir)
    : null;

  return { installSucceeded, gitSucceeded };
}

async function initGit(cwd: string): Promise<boolean> {
  const initOk = await runCommand("git", ["init", "-q"], cwd);
  if (!initOk) return false;
  const addOk = await runCommand("git", ["add", "."], cwd);
  if (!addOk) return false;
  return runCommand(
    "git",
    ["commit", "-q", "-m", "chore: initial commit from create-yage"],
    cwd,
  );
}

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

interface TsConfigJson {
  compilerOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Merges feature deps into `package.json`, preserving any existing entries.
 * Sorted alphabetically per npm convention so diffs stay stable.
 */
export function applyFeaturesToPackageJson(
  pkg: PackageJson,
  features: readonly FeatureId[],
): PackageJson {
  if (features.length === 0) return pkg;

  const deps: Record<string, string> = { ...(pkg.dependencies ?? {}) };
  const devDeps: Record<string, string> = { ...(pkg.devDependencies ?? {}) };

  for (const id of features) {
    const spec = FEATURES[id];
    for (const [name, range] of Object.entries(spec.dependencies)) {
      deps[name] = range;
    }
    if (spec.devDependencies) {
      for (const [name, range] of Object.entries(spec.devDependencies)) {
        devDeps[name] = range;
      }
    }
  }

  return {
    ...pkg,
    dependencies: sortObject(deps),
    devDependencies: sortObject(devDeps),
  };
}

/** Merges feature compilerOptions into `tsconfig.json`. */
export function applyFeaturesToTsConfig(
  cfg: TsConfigJson,
  features: readonly FeatureId[],
): TsConfigJson {
  const compilerOptions: Record<string, unknown> = { ...(cfg.compilerOptions ?? {}) };
  for (const id of features) {
    const opts = FEATURES[id].tsconfigOptions;
    if (!opts) continue;
    for (const [key, value] of Object.entries(opts)) {
      compilerOptions[key] = value;
    }
  }
  return { ...cfg, compilerOptions };
}

function sortObject<T>(obj: Record<string, T>): Record<string, T> {
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, T> = {};
  for (const k of keys) sorted[k] = obj[k] as T;
  return sorted;
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", () => resolvePromise(false));
    child.on("exit", (code) => resolvePromise(code === 0));
  });
}
