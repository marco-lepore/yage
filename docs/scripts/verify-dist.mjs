/**
 * Post-build check of the rendered site: the agent index is served, every
 * page carries the discovery links, and every advertised Markdown counterpart
 * resolves to a served file. Fails the docs build on a regression.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { LLMS_INDEX, resolveLlmDoc } from "./llm-docs.mjs";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));

const DESCRIBEDBY = `<link rel="describedby" href="${LLMS_INDEX}"`;
const ALTERNATE = /<link rel="alternate" type="text\/markdown" href="([^"]+)"/g;
const AGENT_NOTE = "Coding agents: fetch";

function* htmlPages(dir = dist) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlPages(path);
    else if (entry.name === "index.html") yield path;
  }
}

/** Route id of a rendered page: dist/guides/physics/index.html -> guides/physics. */
const routeId = (page) => relative(dist, page).replace(/\/?index\.html$/, "");

for (const file of ["llms.txt", "llms-full.txt", "llms/core-concepts.md"]) {
  assert.ok(existsSync(join(dist, file)), `dist/${file} is missing`);
}

const problems = [];
let pages = 0;
for (const page of htmlPages()) {
  pages += 1;
  const id = routeId(page);
  const html = readFileSync(page, "utf8");
  if (id === "404") continue;
  if (!html.includes(DESCRIBEDBY)) problems.push(`${id}: no describedby link`);
  if (!html.includes(AGENT_NOTE)) problems.push(`${id}: no agent note`);
  const alternates = [...html.matchAll(ALTERNATE)].map((m) => m[1]);
  const expected = resolveLlmDoc(id);
  if (alternates.length > 1) problems.push(`${id}: several alternates`);
  const [alternate] = alternates;
  if (alternate && !existsSync(join(dist, alternate))) {
    problems.push(`${id}: alternate ${alternate} is not served`);
  }
  if (expected && alternate !== expected) {
    problems.push(`${id}: expected alternate ${expected}, got ${alternate}`);
  }
  if (!expected && alternate) {
    problems.push(`${id}: unexpected alternate ${alternate}`);
  }
}
assert.ok(pages > 50, `only ${pages} pages rendered`);
assert.deepEqual(problems, []);

// Representative pages, pinned so a resolver change cannot pass unnoticed.
const pinned = {
  "": null,
  "getting-started/project-structure": null,
  "guides/physics": "/llms/packages/physics.md",
  "addons/dialogue": "/llms/addons/dialogue.md",
  "tooling/scenario-lab": "/llms/tools/lab.md",
  "api/yagejs/core/classes/entity": "/llms/packages/core.md",
};
for (const [id, expected] of Object.entries(pinned)) {
  const html = readFileSync(join(dist, id, "index.html"), "utf8");
  const alternate = [...html.matchAll(ALTERNATE)].map((m) => m[1])[0] ?? null;
  assert.equal(alternate, expected, `alternate on ${id || "/"}`);
}

console.log(`Verified agent discovery links on ${pages} rendered pages.`);
