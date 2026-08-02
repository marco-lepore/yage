import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** A harness that satisfies the runner's shape without booting anything. */
export const STUB_HARNESS = `export default { engine: () => ({}), plugins: () => [] };`;

const created: string[] = [];

/**
 * Writes a throwaway project and returns its root. `files` is keyed by path
 * relative to that root.
 *
 * The path is resolved through `realpath` because a temp directory reaches the
 * project through a symlink on macOS, and Vite names a built page after the
 * input's path relative to the root — a root in symlinked form and an input in
 * resolved form produce a `../` name that Rollup rejects.
 */
export function writeProject(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "yage-lab-")));
  created.push(root);
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents, "utf8");
  }
  return root;
}

/** Removes every project written since the last call. Use in `afterEach`. */
export function removeProjects(): void {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}
