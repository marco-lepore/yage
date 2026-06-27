/**
 * Copies LLM docs from llms/ (authoring source) into public/ (served by Astro).
 * Also concatenates all per-package docs into llms-full.txt.
 *
 * Addon docs are co-located with their package (NOT under docs/llms/): each
 * addon authors its reference at `packages/addons/<name>/docs/llms/*.md`. This
 * script discovers those and copies them into `public/llms/addons/`, so the
 * generated docs output is the single sync surface — addon authors edit one file
 * next to their code and never touch docs/.
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
// Repo-root addons live a level above docs/: <repo>/packages/addons/<name>/.
// `root` is the docs/ dir (path.join normalizes the trailing slash), so one
// `..` reaches the repo root.
const addonsRoot = join(root, "..", "packages", "addons");

/**
 * Collect co-located addon LLM docs: `packages/addons/<name>/docs/llms/*.md`.
 * Returns `{ file, path }` records (file = md filename, path = absolute source).
 * Tolerant of a missing addons dir or addons without a docs/llms folder.
 */
function collectAddonDocs() {
  const docs = [];
  if (!existsSync(addonsRoot)) return docs;
  for (const name of readdirSync(addonsRoot)) {
    const llmsDir = join(addonsRoot, name, "docs", "llms");
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

// Copy co-located addon docs into public/llms/addons/.
const addonDocs = collectAddonDocs();
if (addonDocs.length > 0) {
  mkdirSync(join(dest, "addons"), { recursive: true });
  for (const doc of addonDocs) cpSync(doc.path, join(dest, "addons", doc.file));
}

// Generate llms-full.txt by concatenating all docs (core → packages → addons).
const parts = [];
for (const file of ["core-concepts.md", "quick-start.md", "patterns.md"]) {
  parts.push(readFileSync(join(src, file), "utf8"));
}
for (const file of readdirSync(join(src, "packages")).sort()) {
  if (file.endsWith(".md")) {
    parts.push(readFileSync(join(src, "packages", file), "utf8"));
  }
}
for (const doc of addonDocs) {
  parts.push(readFileSync(doc.path, "utf8"));
}
writeFileSync(join(root, "public", "llms-full.txt"), parts.join("\n---\n\n"));

console.log(`LLM docs copied to public/ (${addonDocs.length} addon doc(s)).`);
