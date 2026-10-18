import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseReportLine } from "../lib/console.js";
import { repoRoot } from "../lib/paths.js";
import {
  hashWebDir,
  readEngineProvenance,
  resolvedDependencies,
  scanForTestProfile,
} from "../lib/report.js";

async function temporaryDir(): Promise<string> {
  return mkdtemp(resolve(tmpdir(), "yage-baseline-harness-"));
}

test("the preload script loads nothing a sandboxed page refuses", async () => {
  const built = await readFile(
    resolve(repoRoot, "packages/host-electron/dist/preload.cjs"),
    "utf8",
  );
  const required = [...built.matchAll(/require\("([^"]+)"\)/g)].map(
    (match) => match[1],
  );
  expect([...new Set(required)]).toEqual(["electron"]);
});

test("a report line is read in both of the forms a host writes", () => {
  expect(parseReportLine('[yage-baseline] {"kind":"boot"}')).toEqual({
    kind: "boot",
  });
  expect(
    parseReportLine('⚡️  [info] - [yage-baseline] {"kind":"case"}'),
  ).toEqual({ kind: "case" });
  expect(parseReportLine("some other line")).toBeNull();
  expect(() => parseReportLine("[yage-baseline] {oops")).toThrow(
    'parseReportLine: malformed report line, got "[yage-baseline] {oops".',
  );
});

test("the release scan finds the reporting prefix only where it is", async () => {
  const dir = await temporaryDir();
  await writeFile(resolve(dir, "clean.js"), "console.log('hello');\n");
  expect(await scanForTestProfile(dir)).toEqual([]);
  await writeFile(
    resolve(dir, "test.js"),
    "console.info('[yage-baseline] x');\n",
  );
  expect(await scanForTestProfile(dir)).toEqual(["test.js"]);
});

test("a directory's digest follows its bytes", async () => {
  const first = await temporaryDir();
  await writeFile(resolve(first, "b.txt"), "second");
  await writeFile(resolve(first, "a.txt"), "first");
  const hashed = await hashWebDir(first);
  expect(hashed.files.map((file) => file.path)).toEqual(["a.txt", "b.txt"]);

  const same = await temporaryDir();
  await writeFile(resolve(same, "a.txt"), "first");
  await writeFile(resolve(same, "b.txt"), "second");
  expect((await hashWebDir(same)).digest).toBe(hashed.digest);

  await writeFile(resolve(same, "b.txt"), "secone");
  expect((await hashWebDir(same)).digest).not.toBe(hashed.digest);
});

test("a run records the engine it built and the versions it resolved", async () => {
  const engine = await readEngineProvenance();
  expect(engine.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(Object.keys(engine.packages).length).toBeGreaterThan(10);
  expect(engine.packages["@yagejs/core"]).toMatch(/^\d+\.\d+\.\d+/);

  const dependencies = resolvedDependencies();
  for (const name of [
    "pixi.js",
    "@pixi/sound",
    "@pixi/ui",
    "yoga-layout",
    "pixi-filters",
    "@dimforge/rapier2d",
    "vite",
  ]) {
    expect(dependencies[name], name).toMatch(/^\d+\.\d+\.\d+/);
  }
});
