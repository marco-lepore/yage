import path from "node:path";
import { build, mergeConfig, type InlineConfig } from "vite";
import pc from "picocolors";
import { LAB_BUILD_PAGE } from "../vite/labPlugin.js";
import { createLabConfig, type LabConfig } from "./labConfig.js";
import { describeProject } from "./report.js";

export interface BuildOptions {
  cwd: string;
  /** Output directory, relative to the Vite root unless absolute. */
  outDir: string;
  scenarios?: readonly string[] | undefined;
}

/**
 * The build config: the project's own, with the lab page as its only input.
 *
 * The input is replaced rather than merged. Merging would concatenate a
 * project whose own `input` is an array, and its game pages would end up in
 * the lab site. The write goes through `rollupOptions` because Vite exposes
 * that name as an accessor onto the options object it actually reads, so
 * rebuilding the object literally would be dropped.
 */
export function labBuildConfig(
  lab: LabConfig,
  opts: { outDir: string; page: string },
): InlineConfig {
  const config = mergeConfig(lab.config, {
    build: { outDir: opts.outDir },
  } satisfies InlineConfig) as InlineConfig;
  const buildOptions = config.build ?? {};
  buildOptions.rollupOptions = {
    ...buildOptions.rollupOptions,
    // Named, so the entry chunk is `index-<hash>.js` rather than one carrying
    // the page's leading dot. Static hosts routinely skip dotfiles.
    input: { index: opts.page },
  };
  config.build = buildOptions;
  return config;
}

/**
 * Vite empties an output directory that sits inside the root, so one that is
 * the project itself, or holds it, would take the project's own files with it.
 */
function checkOutDir(root: string, outDir: string): void {
  const resolved = path.resolve(root, outDir);
  if (resolved === root || root.startsWith(resolved + path.sep)) {
    throw new Error(
      `--out-dir ${outDir} resolves to ${resolved}, which holds the project itself. Build into a directory of its own.`,
    );
  }
}

/** Builds the scenario browser as a static site. */
export async function runBuild(opts: BuildOptions): Promise<void> {
  const lab = await createLabConfig({
    cwd: opts.cwd,
    env: { command: "build", mode: "production" },
    scenarios: opts.scenarios,
  });
  checkOutDir(lab.root, opts.outDir);

  process.stdout.write(`\n  ${pc.green("yage-lab")} ${pc.dim("build")}\n`);
  process.stdout.write(describeProject(lab));

  // A path, not a file: the plugin claims this id and supplies the page from
  // memory, so a build leaves the project untouched.
  const page = path.join(lab.root, LAB_BUILD_PAGE);
  await build(labBuildConfig(lab, { outDir: opts.outDir, page }));
}
