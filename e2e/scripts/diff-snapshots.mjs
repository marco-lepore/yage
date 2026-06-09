#!/usr/bin/env node
// Compare two directories of example snapshot output (produced by the examples
// Playwright project in EXAMPLE_SNAPSHOT_DIR mode) and emit a Markdown report.
//
//   node diff-snapshots.mjs <baseDir> <targetDir> [baseLabel] [targetLabel]
//
// Each directory holds `<slug>.json` (inspector snapshot) and, optionally,
// `<slug>.png` (canvas screenshot). JSON pairs are diffed textually; PNG pairs
// are diffed with pixelmatch. When IMAGE_DIFF_DIR is set, a side-by-side
// base|target|diff composite is written there for every visually-changed
// example, so it can be uploaded as an artifact.
//
// Exits 0 always — this is a review aid, not a gate. The report is written to
// stdout; the caller decides where it lands (step summary, artifact, comment).

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const [, , baseDir, targetDir, baseLabel = "base", targetLabel = "target"] =
  process.argv;

if (!baseDir || !targetDir) {
  console.error("usage: diff-snapshots.mjs <baseDir> <targetDir> [baseLabel] [targetLabel]");
  process.exit(2);
}

const MAX_DIFF_LINES = 300;
const imageDiffDir = process.env["IMAGE_DIFF_DIR"];

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

/**
 * Pixel-compare the two captures of `slug`, if both exist. Returns null when
 * either side has no screenshot, otherwise `{ dims }` on a size mismatch or
 * `{ diffPixels, pct }` (and writes a base|target|diff composite when the
 * images differ and IMAGE_DIFF_DIR is set).
 */
function imageDiff(slug) {
  const basePath = join(baseDir, `${slug}.png`);
  const targetPath = join(targetDir, `${slug}.png`);
  if (!existsSync(basePath) || !existsSync(targetPath)) return null;

  const a = PNG.sync.read(readFileSync(basePath));
  const b = PNG.sync.read(readFileSync(targetPath));
  if (a.width !== b.width || a.height !== b.height) {
    return { dims: `${a.width}×${a.height} → ${b.width}×${b.height}` };
  }

  const { width, height } = a;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: 0.1,
  });

  if (diffPixels > 0 && imageDiffDir) {
    mkdirSync(imageDiffDir, { recursive: true });
    const composite = new PNG({ width: width * 3, height });
    PNG.bitblt(a, composite, 0, 0, width, height, 0, 0);
    PNG.bitblt(b, composite, 0, 0, width, height, width, 0);
    PNG.bitblt(diff, composite, 0, 0, width, height, width * 2, 0);
    writeFileSync(join(imageDiffDir, `${slug}.png`), PNG.sync.write(composite));
  }

  return { diffPixels, pct: (diffPixels / (width * height)) * 100 };
}

function imageNote(img) {
  if (!img) return null;
  if (img.dims) return `canvas size changed: ${img.dims}`;
  if (img.diffPixels === 0) return null;
  return `${img.diffPixels.toLocaleString("en-US")} px differ (${img.pct.toFixed(2)}%)`;
}

const baseSlugs = slugsIn(baseDir);
const targetSlugs = slugsIn(targetDir);
const all = [...new Set([...baseSlugs, ...targetSlugs])].sort();

const changed = [];
const added = [];
const removed = [];
const images = new Map(); // slug -> imageDiff() result, for slugs in both
let unchanged = 0;

for (const slug of all) {
  const inBase = baseSlugs.has(slug);
  const inTarget = targetSlugs.has(slug);
  if (inBase && !inTarget) removed.push(slug);
  else if (!inBase && inTarget) added.push(slug);
  else {
    images.set(slug, imageDiff(slug));
    if (read(baseDir, slug) === read(targetDir, slug)) unchanged++;
    else changed.push(slug);
  }
}

const changedSet = new Set(changed);
// JSON identical but pixels differ — render-level changes the inspector
// state can't see.
const visualOnly = [...images]
  .filter(([slug, img]) => !changedSet.has(slug) && imageNote(img) !== null)
  .map(([slug]) => slug);
const visuallyChanged = [...images].filter(
  ([, img]) => imageNote(img) !== null,
).length;

const out = [];
out.push(`## Example snapshot diff`);
out.push("");
out.push(`Comparing \`${targetLabel}\` (target) against \`${baseLabel}\` (base).`);
out.push("");
out.push(`| Result | Count |`);
out.push(`| --- | --- |`);
out.push(`| Changed | ${changed.length} |`);
out.push(`| Visually changed | ${visuallyChanged} |`);
out.push(`| Added (target only) | ${added.length} |`);
out.push(`| Removed (base only) | ${removed.length} |`);
out.push(`| Unchanged | ${unchanged} |`);
out.push("");

if (added.length) out.push(`**Added:** ${added.map((s) => `\`${s}\``).join(", ")}\n`);
if (removed.length) out.push(`**Removed:** ${removed.map((s) => `\`${s}\``).join(", ")}\n`);

if (changed.length === 0 && visualOnly.length === 0) {
  out.push(added.length || removed.length ? "" : "No behavioral differences. ✅");
} else {
  if (changed.length > 0) {
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
      const note = imageNote(images.get(slug));
      if (note) out.push(`**Image:** ${note} — composite in the run artifacts.\n`);
      out.push("```diff");
      out.push(patch.join("\n").trimEnd() + truncated);
      out.push("```");
      out.push("");
      out.push("</details>");
      out.push("");
    }
  }

  if (visualOnly.length > 0) {
    out.push(`### Visual-only changes`);
    out.push("");
    out.push(
      `Inspector JSON is identical but pixels differ — likely render-level ` +
        `(shaders, blending, draw order). Composites are in the run artifacts.`,
    );
    out.push("");
    out.push(`| Example | Image |`);
    out.push(`| --- | --- |`);
    for (const slug of visualOnly) {
      out.push(`| \`${slug}\` | ${imageNote(images.get(slug))} |`);
    }
    out.push("");
  }
}

process.stdout.write(out.join("\n") + "\n");
