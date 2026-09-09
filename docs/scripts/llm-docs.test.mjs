import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { GROUPS, llmDocSource, resolveLlmDoc } from "./llm-docs.mjs";

const docsDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(docsDir, "..");
const contentDir = join(docsDir, "src", "content", "docs");

/**
 * Pages that intentionally have no Markdown counterpart. Adding a page not
 * covered by the resolver fails the drift test until it is mapped or listed
 * here.
 */
const PAGES_WITHOUT_COUNTERPART = new Set([
  "", // splash page
  "getting-started/project-structure", // package table; llms.txt is the index
]);

/** Authored (non-generated) page ids, e.g. "guides/physics", "addons". */
function authoredPageIds(dir = contentDir) {
  const ids = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // api/ is TypeDoc output, regenerated at build time and git-ignored.
      if (dir === contentDir && entry.name === "api") continue;
      ids.push(...authoredPageIds(path));
    } else if (/\.mdx?$/.test(entry.name)) {
      ids.push(
        relative(contentDir, path)
          .replace(/\.mdx?$/, "")
          .replace(/(^|\/)index$/, ""),
      );
    }
  }
  return ids.sort();
}

/** Every Markdown reference the copy pipeline serves, as `/llms/...` paths. */
function servedLlmDocs() {
  const served = [];
  const llms = join(docsDir, "llms");
  for (const file of readdirSync(llms)) {
    if (file.endsWith(".md")) served.push(`/llms/${file}`);
  }
  for (const file of readdirSync(join(llms, "packages"))) {
    if (file.endsWith(".md")) served.push(`/llms/packages/${file}`);
  }
  for (const group of GROUPS) {
    const groupRoot = join(repoRoot, "packages", group);
    if (!existsSync(groupRoot)) continue;
    for (const name of readdirSync(groupRoot)) {
      const dir = join(groupRoot, name, "docs", "llms");
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (file.endsWith(".md")) served.push(`/llms/${group}/${file}`);
      }
    }
  }
  return served.sort();
}

test("representative pages resolve to the expected Markdown reference", () => {
  assert.equal(resolveLlmDoc("guides/physics"), "/llms/packages/physics.md");
  assert.equal(
    resolveLlmDoc("guides/rendering/camera"),
    "/llms/packages/renderer.md",
  );
  assert.equal(resolveLlmDoc("concepts/scenes"), "/llms/core-concepts.md");
  assert.equal(resolveLlmDoc("patterns/testing"), "/llms/patterns.md");
  assert.equal(resolveLlmDoc("addons"), "/llms/addons.md");
  assert.equal(resolveLlmDoc("addons/dialogue"), "/llms/addons/dialogue.md");
  assert.equal(resolveLlmDoc("tooling/scenario-lab"), "/llms/tools/lab.md");
  assert.equal(resolveLlmDoc("tooling/feedback"), "/llms/tools/feedback.md");
  assert.equal(
    resolveLlmDoc("api/yagejs/core/classes/entity"),
    "/llms/packages/core.md",
  );
  assert.equal(
    resolveLlmDoc("api/yagejs-tools/lab/functions/definescenario"),
    "/llms/tools/lab.md",
  );
});

test("pages without a counterpart resolve to null", () => {
  assert.equal(resolveLlmDoc(""), null);
  assert.equal(resolveLlmDoc("index"), null);
  assert.equal(resolveLlmDoc("404"), null);
  assert.equal(resolveLlmDoc("api/readme"), null);
  assert.equal(resolveLlmDoc("getting-started/project-structure"), null);
});

test("every authored page is mapped or listed as having no counterpart", () => {
  const unmapped = authoredPageIds().filter(
    (id) => resolveLlmDoc(id) === null && !PAGES_WITHOUT_COUNTERPART.has(id),
  );
  assert.deepEqual(unmapped, []);
  const stale = [...PAGES_WITHOUT_COUNTERPART].filter(
    (id) => resolveLlmDoc(id) !== null,
  );
  assert.deepEqual(stale, [], "listed as unmapped but the resolver maps it");
});

test("every mapped reference is authored where the copy pipeline reads it", () => {
  const missing = [];
  for (const id of authoredPageIds()) {
    const served = resolveLlmDoc(id);
    if (served && !existsSync(join(repoRoot, llmDocSource(served)))) {
      missing.push(`${id} -> ${served} (${llmDocSource(served)})`);
    }
  }
  assert.deepEqual(missing, []);
});

test("llms.txt links every served reference and nothing else", () => {
  const index = readFileSync(join(docsDir, "llms.txt"), "utf8");
  const linked = [...index.matchAll(/\]\((llms\/[^)]+\.md)\)/g)]
    .map((m) => `/${m[1]}`)
    .sort();
  assert.deepEqual(linked, servedLlmDocs());
});

test("llms.txt opens with the agent routing instructions", () => {
  const index = readFileSync(join(docsDir, "llms.txt"), "utf8");
  const section = index.indexOf("## For coding agents");
  assert.ok(section > 0);
  assert.ok(section < index.indexOf("## Docs"));
  assert.match(index, /llms-full\.txt/);
});
