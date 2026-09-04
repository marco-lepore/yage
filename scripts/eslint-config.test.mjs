import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({ cwd: repoRoot });

async function restrictedRules(path, code) {
  const [result] = await eslint.lintText(code, { filePath: path });
  return result.messages
    .filter((message) =>
      [
        "no-restricted-globals",
        "no-restricted-properties",
        "no-restricted-syntax",
      ].includes(message.ruleId ?? ""),
    )
    .map((message) => message.ruleId)
    .sort();
}

test("runtime restrictions cover nested TS and TSX packages", async () => {
  const code = "Math.random(); Date.now(); performance.now();";
  assert.deepEqual(
    await restrictedRules("packages/addons/demo/src/probe.ts", code),
    [
      "no-restricted-properties",
      "no-restricted-syntax",
      "no-restricted-syntax",
    ],
  );
  assert.deepEqual(
    await restrictedRules("packages/ui-react/src/probe.tsx", code),
    [
      "no-restricted-properties",
      "no-restricted-syntax",
      "no-restricted-syntax",
    ],
  );
});

test("wall-clock allow-list does not disable the random restriction", async () => {
  assert.deepEqual(
    await restrictedRules(
      "packages/core/src/GameLoop.ts",
      "Math.random(); Date.now(); performance.now();",
    ),
    ["no-restricted-properties"],
  );
  assert.deepEqual(
    await restrictedRules(
      "packages/tools/lab/src/runner/LabPanel.ts",
      "Math.random(); Date.now(); setTimeout(() => {}, 0);",
    ),
    ["no-restricted-properties", "no-restricted-syntax"],
  );
});

test("tests and the random seed source remain exempt", async () => {
  const code = "Math.random(); Date.now(); performance.now();";
  assert.deepEqual(
    await restrictedRules("packages/core/src/probe.test.ts", code),
    [],
  );
  assert.deepEqual(
    await restrictedRules("packages/core/src/Random.ts", code),
    [],
  );
});
