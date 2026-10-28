import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { hashDirectory } from "@yagejs-tools/pack";
import { REPORT_PREFIX } from "./console.js";
import { readLocalPackages } from "./localPackages.mjs";
import { repoRoot, workDir } from "./paths.js";
import type { BaselineProfile } from "./build.js";

/** Which shell ran the build. */
export type ReportTarget = "browser" | "electron" | "ios-simulator";

/** What one check in a run concluded. */
export interface ReportCheck {
  name: string;
  result: "passed" | "failed" | "pending";
  /** Where the outcome came from; `harness` is the suite's own record. */
  evidence: "inspector" | "console" | "process" | "visual" | "file" | "harness";
  detail: string | null;
}

/** One file of a built web directory. */
export interface ReportFile {
  path: string;
  bytes: number;
  sha256: string;
}

/** What a single run of one target records. */
export interface BaselineRunReport {
  schema: 1;
  run: {
    id: string;
    startedAt: string;
    finishedAt: string;
    status: "passed" | "failed";
    failure: string | null;
  };
  target: ReportTarget;
  profile: BaselineProfile;
  subject:
    | { kind: "fixture" }
    | { kind: "game"; label: string; provenance: string };
  engine: { commit: string; dirty: string[]; packages: Record<string, string> };
  dependencies: Record<string, string>;
  shell: {
    kind: "chromium" | "electron" | "capacitor";
    version: string;
    details: Record<string, string>;
  };
  system: {
    os: string;
    osVersion: string;
    arch: string;
    device: {
      name: string;
      udid: string;
      runtime: string;
      kind: "simulator";
    } | null;
  };
  webView: { userAgent: string | null };
  build: { webDir: string; files: ReportFile[]; digest: string };
  checks: ReportCheck[];
  readings: { step: string; at: string; reading: unknown }[];
  timeline: {
    at: number;
    source: "page" | "shell" | "harness";
    event: string;
    data: unknown;
  }[];
  errors: {
    page: string[];
    console: string[];
    requestFailures: { url: string; error: string }[];
    callback: unknown[];
    shell: string[];
  };
  screenshots: { path: string; label: "visual" }[];
}

/** Where the reports of every run land. */
export const reportsDir = resolve(workDir, "reports");

/**
 * The engine commit, its uncommitted files, and the version of every package
 * in this repository: engine packages, addons and tools.
 */
export async function readEngineProvenance(): Promise<
  BaselineRunReport["engine"]
> {
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
    }).trim();
  const packages: Record<string, string> = {};
  for (const [name, dir] of readLocalPackages()) {
    const manifest = JSON.parse(
      await readFile(resolve(repoRoot, dir, "package.json"), "utf8"),
    ) as { version: string };
    packages[name] = manifest.version;
  }
  return {
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain")
      .split("\n")
      .filter((line) => line !== ""),
    packages,
  };
}

/** Which workspace each third-party dependency is resolved from. */
const DEPENDENCY_OWNERS: Record<string, string> = {
  "pixi.js": "packages/renderer",
  "@pixi/ui": "packages/ui",
  "yoga-layout": "packages/ui",
  "pixi-filters": "packages/effects",
  "@dimforge/rapier2d": "packages/physics",
  vite: "e2e",
};

/**
 * The third-party versions this build actually used, each read from the copy
 * Node resolves for the workspace that depends on it.
 */
export function resolvedDependencies(root = repoRoot): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const [name, owner] of Object.entries(DEPENDENCY_OWNERS)) {
    const manifest = findInstalledManifest(resolve(root, owner), name, root);
    if (manifest === null) {
      versions[name] = "not resolved";
      continue;
    }
    const raw = JSON.parse(readFileSync(manifest, "utf8")) as {
      version: string;
    };
    versions[name] = raw.version;
  }
  return versions;
}

/** Every file of a built directory, with its size and hash. */
export async function hashWebDir(
  dir: string,
): Promise<{ files: ReportFile[]; digest: string }> {
  const hashed = await hashDirectory(dir);
  return { files: [...hashed.files], digest: hashed.digest };
}

/** The emitted files that carry the test profile's reporting prefix. */
export async function scanForTestProfile(dir: string): Promise<string[]> {
  const needle = Buffer.from(REPORT_PREFIX);
  const found: string[] = [];
  for (const path of await listFiles(dir)) {
    const bytes = await readFile(path);
    if (bytes.includes(needle)) found.push(relative(dir, path));
  }
  return found.sort();
}

/** What this machine runs. */
export function readSystem(): BaselineRunReport["system"] {
  return {
    os: "macOS",
    osVersion: execFileSync("sw_vers", ["-productVersion"], {
      encoding: "utf8",
    }).trim(),
    arch: process.arch,
    device: null,
  };
}

/** Write one run's report and return the file it landed in. */
export async function writeReport(report: BaselineRunReport): Promise<string> {
  await mkdir(reportsDir, { recursive: true });
  const stamp = report.run.startedAt.replace(/[:.]/g, "-");
  const path = resolve(
    reportsDir,
    `${report.target}-${report.profile}-${stamp}.json`,
  );
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

/**
 * Where a dependency is actually installed for one workspace: its own
 * `node_modules` first, then each directory up to the repository root, which
 * is where a hoisted install puts it.
 */
function findInstalledManifest(
  from: string,
  name: string,
  root: string,
): string | null {
  let dir = from;
  for (;;) {
    const manifest = resolve(dir, "node_modules", name, "package.json");
    if (existsSync(manifest)) return manifest;
    if (dir === root) return null;
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
