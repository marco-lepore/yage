import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { HARNESS_CANDIDATES } from "../vite/labPlugin.js";
import { planHarness } from "./harnessTemplate.js";
import {
  findViteConfig,
  loadProjectConfig,
  readEngineDependencies,
} from "./project.js";

/**
 * Where the harness goes. The same constant the lookup probes first, so the
 * two cannot drift.
 */
export const HARNESS_FILE = HARNESS_CANDIDATES[0];

export interface InitOptions {
  cwd: string;
  /** Overwrite an existing harness. */
  force: boolean;
}

/** The harness the lookup would find, whatever its extension. */
function findExisting(root: string): string | undefined {
  return HARNESS_CANDIDATES.map((name) => path.join(root, name)).find(
    (file) => existsSync(file),
  );
}

/**
 * Writes `lab/harness.ts`, prefilled from the engine packages the project
 * depends on.
 *
 * Nothing else is touched: the harness is the one file the lab needs, and the
 * scenario glob has a default, so a project is browsable with no further
 * edits.
 */
export async function runInit(opts: InitOptions): Promise<void> {
  // The harness is looked up under the Vite root, which a project's own config
  // can move away from the directory the command runs in.
  const configFile = findViteConfig(opts.cwd);
  const project = configFile
    ? await loadProjectConfig(
        configFile,
        { command: "serve", mode: "development" },
        opts.cwd,
      )
    : {};
  const root = path.resolve(opts.cwd, project.root ?? ".");

  const existing = findExisting(root);
  if (existing !== undefined && !opts.force) {
    throw new Error(
      `${path.relative(opts.cwd, existing) || existing} already exists. Pass --force to overwrite it.`,
    );
  }

  // package.json sits at the project root even when Vite's root is elsewhere.
  const dependencies = readEngineDependencies(opts.cwd);
  if (dependencies === undefined) {
    throw new Error(
      `No package.json in ${opts.cwd}. Run this from the project root.`,
    );
  }
  for (const required of ["@yagejs/core", "@yagejs/renderer"]) {
    if (!dependencies.has(required)) {
      throw new Error(
        `${required} is not a dependency of this project. A scenario runs in a ` +
          `real engine and is rendered into a canvas, so the harness needs it.`,
      );
    }
  }

  const plan = planHarness(dependencies);
  const file = path.join(root, HARNESS_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, plan.source, "utf8");

  process.stdout.write(`\n  ${pc.green("yage-lab")} ${pc.dim("init")}\n`);
  process.stdout.write(
    `  ${pc.dim("wrote")}      ${path.relative(opts.cwd, file) || file}\n`,
  );
  process.stdout.write(
    `  ${pc.dim("plugins")}    ${plan.plugins.join(", ")}\n`,
  );
  // A harness that silently omits a plugin the project installed looks like
  // the tool missing it, so name the package that would bring it in.
  for (const { className, missing } of plan.skipped) {
    process.stdout.write(
      `  ${pc.yellow("skipped")}    ${className} — install ${missing.join(" and ")}\n`,
    );
  }
  if (!dependencies.has("@yagejs/debug")) {
    process.stdout.write(
      `  ${pc.yellow("note")}       @yagejs/debug is not installed. Add it and declare ` +
        `DebugPlugin to step the clock from a scenario.\n`,
    );
  }
  process.stdout.write(`\n  Write a *.scenario.ts file, then run yage-lab.\n\n`);
}
