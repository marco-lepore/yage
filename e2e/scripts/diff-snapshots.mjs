#!/usr/bin/env node
// Compare two directories of example snapshot JSON (produced by the examples
// Playwright project in EXAMPLE_SNAPSHOT_DIR mode) and emit a Markdown report.
//
//   node diff-snapshots.mjs <baseDir> <targetDir> [baseLabel] [targetLabel]
//
// Exits 0 always — this is a review aid, not a gate. The report is written to
// stdout; the caller decides where it lands (step summary, artifact, comment).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const [, , baseDir, targetDir, baseLabel = "base", targetLabel = "target"] =
  process.argv;

if (!baseDir || !targetDir) {
  console.error("usage: diff-snapshots.mjs <baseDir> <targetDir> [baseLabel] [targetLabel]");
  process.exit(2);
}

const MAX_DIFF_LINES = 300;

function slugsIn(dir) {
  try {
    return new Set(
      readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => basename(f, ".json")),
    );
  } catch {
    return new Set();
  }
}

function read(dir, slug) {
  return readFileSync(join(dir, `${slug}.json`), "utf8");
}

function unifiedDiff(slug) {
  try {
    execFileSync("diff", [
      "-u",
      "--label", `${baseLabel}/${slug}`,
      "--label", `${targetLabel}/${slug}`,
      join(baseDir, `${slug}.json`),
      join(targetDir, `${slug}.json`),
    ]);
    return ""; // identical
  } catch (err) {
    // `diff` exits 1 when files differ; the patch text is on stdout.
    return err.stdout ? err.stdout.toString() : String(err);
  }
}

const baseSlugs = slugsIn(baseDir);
const targetSlugs = slugsIn(targetDir);
const all = [...new Set([...baseSlugs, ...targetSlugs])].sort();

const changed = [];
const added = [];
const removed = [];
let unchanged = 0;

for (const slug of all) {
  const inBase = baseSlugs.has(slug);
  const inTarget = targetSlugs.has(slug);
  if (inBase && !inTarget) removed.push(slug);
  else if (!inBase && inTarget) added.push(slug);
  else if (read(baseDir, slug) === read(targetDir, slug)) unchanged++;
  else changed.push(slug);
}

const out = [];
out.push(`## Example snapshot diff`);
out.push("");
out.push(`Comparing \`${targetLabel}\` (target) against \`${baseLabel}\` (base).`);
out.push("");
out.push(`| Result | Count |`);
out.push(`| --- | --- |`);
out.push(`| Changed | ${changed.length} |`);
out.push(`| Added (target only) | ${added.length} |`);
out.push(`| Removed (base only) | ${removed.length} |`);
out.push(`| Unchanged | ${unchanged} |`);
out.push("");

if (added.length) out.push(`**Added:** ${added.map((s) => `\`${s}\``).join(", ")}\n`);
if (removed.length) out.push(`**Removed:** ${removed.map((s) => `\`${s}\``).join(", ")}\n`);

if (changed.length === 0) {
  out.push(added.length || removed.length ? "" : "No behavioral differences. ✅");
} else {
  out.push(`### Changed examples`);
  out.push("");
  for (const slug of changed) {
    let patch = unifiedDiff(slug).split("\n");
    let truncated = "";
    if (patch.length > MAX_DIFF_LINES) {
      truncated = `\n… ${patch.length - MAX_DIFF_LINES} more lines truncated …`;
      patch = patch.slice(0, MAX_DIFF_LINES);
    }
    out.push(`<details><summary><code>${slug}</code></summary>`);
    out.push("");
    out.push("```diff");
    out.push(patch.join("\n").trimEnd() + truncated);
    out.push("```");
    out.push("");
    out.push("</details>");
    out.push("");
  }
}

process.stdout.write(out.join("\n") + "\n");
