import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Validates a string as a valid npm package name per the rules in
 * https://docs.npmjs.com/cli/v10/configuring-npm/package-json#name.
 * This is a simplified check — we don't accept scoped names since a scaffolded
 * game project isn't typically published.
 */
export function validateProjectName(name: string): string | undefined {
  if (!name || name.length === 0) return "Name cannot be empty";
  if (name.length > 214) return "Name cannot exceed 214 characters";
  if (name.startsWith(".") || name.startsWith("_")) {
    return "Name cannot start with a dot or underscore";
  }
  if (name.trim() !== name) return "Name cannot contain leading/trailing whitespace";
  if (name !== name.toLowerCase()) return "Name must be lowercase";
  if (/[~'!()*]/.test(name)) {
    return "Name cannot contain ~'!()* characters";
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    return "Name can only contain lowercase letters, numbers, dots, hyphens, and underscores";
  }
  return undefined;
}

/**
 * Derives a sensible default project name from a target directory path.
 * Strips leading dots and replaces invalid characters with hyphens so the
 * result is safe to use as both a directory name and an npm package name.
 */
export function deriveProjectName(targetDir: string): string {
  const base = targetDir.split(/[/\\]/).filter(Boolean).pop() ?? "my-yage-game";
  return base
    .toLowerCase()
    .replace(/^[._]+/, "")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "") || "my-yage-game";
}

export type DirectoryState =
  | { kind: "missing" }
  | { kind: "empty" }
  | { kind: "non-empty"; entries: string[] };

/**
 * Inspects a target directory to decide whether it's safe to scaffold into.
 * Hidden files like .git are treated as meaningful contents.
 */
export function inspectDirectory(target: string): DirectoryState {
  if (!existsSync(target)) return { kind: "missing" };
  const stat = statSync(target);
  if (!stat.isDirectory()) {
    return { kind: "non-empty", entries: [target] };
  }
  const entries = readdirSync(target);
  if (entries.length === 0) return { kind: "empty" };
  return { kind: "non-empty", entries };
}

/**
 * Explicit rename rules for files whose template-time names differ from
 * their scaffolded-time names. `_package.json` is prefixed so npm workspaces
 * don't see it as a real package; `_gitignore` is prefixed so it doesn't
 * accidentally gitignore the template directory itself.
 */
const RENAME_FILES: Record<string, string> = {
  _package: "package.json",
  _gitignore: ".gitignore",
  "_package.json": "package.json",
};

/**
 * Recursively copies a directory, applying the `RENAME_FILES` map to any
 * file whose source name needs to change when scaffolded.
 */
export async function copyTemplateDirectory(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const renamed = RENAME_FILES[entry.name] ?? entry.name;
    const targetPath = join(targetDir, renamed);

    if (entry.isDirectory()) {
      await copyTemplateDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }
  }
}

/**
 * Reads, transforms, and rewrites a JSON file. Used to rename the scaffolded
 * project inside its package.json after the template has been copied.
 */
export async function rewriteJson<T>(
  filePath: string,
  transform: (data: T) => T,
): Promise<void> {
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw) as T;
  const next = transform(data);
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
}

/**
 * Returns the templates root directory relative to the bundled CLI entry.
 * After tsup bundles src/index.ts → dist/index.js, the templates directory
 * lives at ../templates from the bundle.
 */
export function resolveTemplatesRoot(importMetaUrl: string): string {
  const filePath = new URL(importMetaUrl).pathname;
  const distDir = dirname(filePath);
  return resolve(distDir, "..", "templates");
}

export function relativeFromCwd(target: string): string {
  const rel = relative(process.cwd(), target);
  return rel.length === 0 ? "." : rel;
}
