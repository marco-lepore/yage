/**
 * Copies LLM docs from llms/ (authoring source) into public/ (served by Astro).
 * Also concatenates all per-package docs into llms-full.txt.
 *
 * Addon and tool docs are co-located with their package (NOT under docs/llms/):
 * each authors its reference at `packages/<group>/<name>/docs/llms/*.md`. This
 * script discovers those and copies them into `public/llms/<group>/`, so the
 * generated docs output is the single sync surface — authors edit one file next
 * to their code and never touch docs/.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "llms");
const dest = join(root, "public", "llms");
// Packages live a level above docs/: <repo>/packages/<group>/<name>/.
// `root` is the docs/ dir (path.join normalizes the trailing slash), so one
// `..` reaches the repo root.
const packagesRoot = join(root, "..", "packages");
/** Package groups that author their own docs. Each is served from llms/<group>/. */
const GROUPS = ["addons", "tools"];

/**
 * Collect co-located LLM docs: `packages/<group>/<name>/docs/llms/*.md`.
 * Returns `{ file, path }` records (file = md filename, path = absolute source).
 * Tolerant of a missing group dir or packages without a docs/llms folder.
 */
function collectGroupDocs(group) {
  const docs = [];
  const groupRoot = join(packagesRoot, group);
  if (!existsSync(groupRoot)) return docs;
  for (const name of readdirSync(groupRoot)) {
    const llmsDir = join(groupRoot, name, "docs", "llms");
    if (!existsSync(llmsDir)) continue;
    for (const file of readdirSync(llmsDir)) {
      if (file.endsWith(".md")) docs.push({ file, path: join(llmsDir, file) });
    }
  }
  // Stable order so llms-full.txt is deterministic across runs.
  return docs.sort((a, b) => a.file.localeCompare(b.file));
}

// Copy llms.txt to public root
cpSync(join(src, "..", "llms.txt"), join(root, "public", "llms.txt"));

// Copy llms/ directory to public/llms/
mkdirSync(join(dest, "packages"), { recursive: true });
for (const file of readdirSync(src)) {
  if (file.endsWith(".md")) cpSync(join(src, file), join(dest, file));
}
for (const file of readdirSync(join(src, "packages"))) {
  if (file.endsWith(".md")) cpSync(join(src, "packages", file), join(dest, "packages", file));
}

// Copy co-located docs into public/llms/<group>/.
const groupDocs = GROUPS.map((group) => ({
  group,
  docs: collectGroupDocs(group),
}));
for (const { group, docs } of groupDocs) {
  if (docs.length === 0) continue;
  mkdirSync(join(dest, group), { recursive: true });
  for (const doc of docs) cpSync(doc.path, join(dest, group, doc.file));
}

// Generate llms-full.txt by concatenating all docs (core → packages → groups).
const parts = [];
for (const file of [
  "core-concepts.md",
  "quick-start.md",
  "patterns.md",
  "play-sessions.md",
]) {
  parts.push(readFileSync(join(src, file), "utf8"));
}
for (const file of readdirSync(join(src, "packages")).sort()) {
  if (file.endsWith(".md")) {
    parts.push(readFileSync(join(src, "packages", file), "utf8"));
  }
}
for (const { docs } of groupDocs) {
  for (const doc of docs) parts.push(readFileSync(doc.path, "utf8"));
}
writeFileSync(join(root, "public", "llms-full.txt"), parts.join("\n---\n\n"));

const counts = groupDocs
  .map(({ group, docs }) => `${docs.length} ${group}`)
  .join(", ");
console.log(`LLM docs copied to public/ (${counts}).`);
