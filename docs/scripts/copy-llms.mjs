/**
 * Copies LLM docs from llms/ (authoring source) into public/ (served by Astro).
 * Also concatenates all per-package docs into llms-full.txt.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "llms");
const dest = join(root, "public", "llms");

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

// Generate llms-full.txt by concatenating all docs
const parts = [];
for (const file of ["core-concepts.md", "quick-start.md", "patterns.md"]) {
  parts.push(readFileSync(join(src, file), "utf8"));
}
for (const file of readdirSync(join(src, "packages")).sort()) {
  if (file.endsWith(".md")) {
    parts.push(readFileSync(join(src, "packages", file), "utf8"));
  }
}
writeFileSync(join(root, "public", "llms-full.txt"), parts.join("\n---\n\n"));

console.log("LLM docs copied to public/");
