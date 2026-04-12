import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { TemplateId } from "./templates.js";
import { copyTemplateDirectory, rewriteJson } from "./utils.js";

export interface ScaffoldOptions {
  targetDir: string;
  projectName: string;
  template: TemplateId;
  templatesRoot: string;
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

  await rewriteJson<{ name: string; [key: string]: unknown }>(
    join(options.targetDir, "package.json"),
    (pkg) => ({ ...pkg, name: options.projectName }),
  );

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
