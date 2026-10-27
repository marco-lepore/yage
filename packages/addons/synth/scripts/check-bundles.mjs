import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { synthInstruments } from "../dist/esm/instruments.js";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const names = Object.keys(synthInstruments);
const rows = [];

async function bundle(path, symbol, format, minify = true) {
  const contents =
    format === "esm"
      ? `export { ${symbol} } from "${path}";`
      : `exports.value = require("${path}").${symbol};`;
  const result = await build({
    stdin: { contents, resolveDir: packageDir },
    platform: "browser",
    format,
    bundle: true,
    minify,
    write: false,
    metafile: true,
    external: ["@yagejs/core", "@yagejs/audio"],
  });
  return { code: result.outputFiles[0].text, meta: result.metafile };
}
function assertPure(meta, label) {
  for (const output of Object.values(meta.outputs)) {
    assert.equal(
      output.imports.length,
      0,
      `${label} imports a runtime dependency`,
    );
  }
}
function assertInstruments(code, expected, label) {
  for (const name of names) {
    assert.equal(
      code.includes(`"${name}"`),
      expected.includes(name),
      `${label}: instrument ${name}`,
    );
  }
}
function record(label, code) {
  rows.push({
    import: label,
    bytes: Buffer.byteLength(code),
    gzip: gzipSync(code).length,
  });
}

// Node tools and workers load these entries without a bundler, in either
// module format, so they must stay free of engine imports and instruments.
for (const format of ["esm", "cjs"]) {
  for (const [path, symbol] of [
    ["@yagejs-addons/synth/render", "renderSynthSample"],
    ["@yagejs-addons/synth/worker", "serveSynthWorker"],
  ]) {
    const label = `${format} ${symbol}`;
    const { code, meta } = await bundle(path, symbol, format);
    assertPure(meta, label);
    assertInstruments(code, [], label);
    record(label, code);
  }
}

// The root entry imports the engine peers for SynthPlugin and contains no
// instrument code.
for (const symbol of [
  "renderSynthPatch",
  "synthBuffer",
  "synthPresets",
  "SynthPlugin",
]) {
  const label = `esm ${symbol}`;
  const { code } = await bundle("@yagejs-addons/synth", symbol, "esm");
  assertInstruments(code, [], label);
  record(label, code);
}

// A named import from the instrument barrel keeps that instrument's renderer
// and drops every other one.
for (const name of names) {
  const label = `esm ${name}`;
  const { code, meta } = await bundle(
    "@yagejs-addons/synth/instruments",
    name,
    "esm",
  );
  assertPure(meta, label);
  assertInstruments(code, [name], label);
  const readable = await bundle(
    "@yagejs-addons/synth/instruments",
    name,
    "esm",
    false,
  );
  for (const other of names) {
    if (other === name || ["flute", "clarinet", "organ"].includes(other))
      continue;
    const renderer =
      other === "tom"
        ? "renderLowTom"
        : other.endsWith("Noise")
          ? other
          : `render${other[0].toUpperCase()}${other.slice(1)}`;
    assert.equal(
      new RegExp(`function ${renderer}\\b`).test(readable.code),
      false,
      `${label} retains ${renderer}`,
    );
  }
  if (["flute", "banjo"].includes(name)) record(label, code);
}

for (const format of ["esm", "cjs"]) {
  const catalogue = await bundle(
    "@yagejs-addons/synth/instruments",
    "synthInstruments",
    format,
  );
  assertPure(catalogue.meta, `${format} catalogue`);
  assertInstruments(catalogue.code, names, `${format} catalogue`);
  record(`${format} synthInstruments`, catalogue.code);
}
console.table(rows);
