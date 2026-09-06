// @vitest-environment node
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const BROWSER = join(HERE, "browser");

function sourcesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts")) {
      return [];
    }
    return entry.name.endsWith(".test.tsx") ? [] : [path];
  });
}

/**
 * Long enough for one ESLint configuration resolution per browser file while
 * the rest of the repository's tasks run beside this one. The work grows with
 * the directory, and the default five seconds is a budget it shares.
 */
const RESOLVE_TIMEOUT = 30_000;

/**
 * Every browser file is governed by one of the import blocks in the
 * repository's ESLint config.
 *
 * It sits here rather than beside the files it covers because those files are
 * browser code and this reads the filesystem.
 *
 * The blocks are written as one broad rule plus narrower ones that excuse a
 * directory from it, so a directory can be excused and then matched by nothing
 * at all. Lint stays green in that state, because a file no block matches is
 * never checked — which is exactly the state this asserts against. Reading the
 * resolved configuration is the only way to see it; running lint cannot.
 */
describe("browser import boundaries", () => {
  it(
    "restricts server and Node imports in every browser file",
    async () => {
      const eslint = new ESLint({ cwd: ROOT });
      const ungoverned: string[] = [];
      for (const file of sourcesUnder(BROWSER)) {
        const config = await eslint.calculateConfigForFile(file);
        const rule = config.rules?.["@typescript-eslint/no-restricted-imports"];
        const groups = Array.isArray(rule)
          ? (
              (rule[1] as { patterns?: { group?: string[] }[] }).patterns ?? []
            ).flatMap((pattern) => pattern.group ?? [])
          : [];
        if (!groups.includes("**/server") || !groups.includes("node:*")) {
          ungoverned.push(relative(ROOT, file));
        }
      }
      expect(ungoverned).toEqual([]);
    },
    RESOLVE_TIMEOUT,
  );
});
