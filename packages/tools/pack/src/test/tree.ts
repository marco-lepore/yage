import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

/** Every tree made since the last {@link removeTrees}. */
const created: string[] = [];

/** Write a tree of files under a fresh temporary directory and return it. */
export function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "yage-pack-"));
  created.push(root);
  for (const [file, body] of Object.entries(files)) addFile(root, file, body);
  return root;
}

/**
 * Remove every tree made since the last call. Use in `afterEach`, after any
 * step that moves the working directory back out of a tree.
 */
export function removeTrees(): void {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Add one file to an existing tree, creating the directories it needs. */
export function addFile(root: string, file: string, body: string): string {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

/** An installed package, as a test's `node_modules` holds it. */
export function installed(
  name: string,
  manifest: Record<string, unknown> = {},
): Record<string, string> {
  return {
    [`node_modules/${name}/package.json`]: `${JSON.stringify({
      name,
      version: "1.0.0",
      ...manifest,
    })}\n`,
  };
}

/** Every file of a tree, by its path, so a test can pin that nothing moved. */
export function snapshot(root: string): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (statSync(full).isDirectory()) walk(full);
      else found[path.relative(root, full)] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return found;
}
