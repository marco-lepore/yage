import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkDocuments,
  declarationEntries,
  extractSnippets,
  parseMetadata,
} from "./check-snippets.mjs";

const fence = (code, metadata = "", language = "ts") =>
  `\`\`\`${language} ${metadata}\n${code}\n\`\`\``;

test("built YAGE declarations expose valid examples and deliberate violations", () => {
  const documents = [
    [
      "valid",
      fence(
        'import { Engine } from "@yagejs/core";\nconst engine = new Engine({ debug: true });',
      ),
    ],
    [
      "option",
      fence(
        'import { Engine } from "@yagejs/core";\nnew Engine({ nonexistentOption: true });',
      ),
    ],
    ["syntax", fence("const value = ;")],
    ["semantic", fence("const amount: number = 'wrong';")],
    ["host", fence("entity.id;", 'yage-context="entity"')],
    [
      "component",
      fence(
        'import { Vec2 } from "@yagejs/core";\nconst position = new Vec2(1, 2);\nthis.entity.id;',
        'yage-context="component"',
      ),
    ],
    ["scene", fence("this.name;", 'yage-context="scene-enter"')],
    [
      "inline-import",
      fence(
        'import { Vec2 } from "@yagejs/core"; this.entity.id;',
        'yage-context="component"',
      ),
    ],
    [
      "negative",
      fence("// yage-expect-error TS2322\nconst amount: number = 'wrong';"),
    ],
    ["stale", fence("// yage-expect-error TS2322\nconst amount: number = 1;")],
    [
      "expectation-string",
      fence('const instruction = "// yage-expect-error TS2322";'),
    ],
    [
      "unrelated",
      fence(
        "// yage-expect-error TS2322\nconst amount: number = 'wrong';\nconst second: string = 2;",
      ),
    ],
    ["import", fence('import { NonexistentExport } from "@yagejs/core";')],
    ["side-effect-valid", fence('import "pixi.js/advanced-blend-modes";')],
    ["side-effect-missing", fence('import "pixi.js/advanced-blend-mode";')],
    ["side-effect-unknown", fence('import "nonexistent-snippet-module";')],
    ["tsx", fence("const element = <div nonexistentProp={1} />;", "", "tsx")],
    [
      "syntax-only",
      fence(
        "gameSpecificAction();",
        'yage-check="syntax" yage-reason="Game-local algorithm with intentionally unspecified game contracts."',
      ),
    ],
    ["missing-context", fence("entity.id;")],
    ["duplicate-context", fence("const entity = 1;", 'yage-context="entity"')],
    ["suppression", fence("// @ts-ignore\nconst amount: number = 'wrong';")],
    [
      "block-suppression",
      fence("/* @ts-ignore */\nconst amount: number = 'wrong';"),
    ],
    [
      "block-expectation",
      fence("/* @ts-expect-error */\nconst amount: number = 'wrong';"),
    ],
    ["no-check", fence("// @ts-nocheck\nconst amount: number = 'wrong';")],
    [
      "suppression-string",
      fence(
        'const text = "/* @ts-ignore */";\nconst amount: number = "wrong";',
      ),
    ],
    [
      "global-declaration",
      fence("declare global { const foreignGameValue: number; }"),
    ],
    ["global-isolation", fence("foreignGameValue;")],
    [
      "augmentation-declaration",
      fence(
        'import "@yagejs/core";\ndeclare module "@yagejs/core" {\n  interface Scene {\n    snippetOnlyField: number;\n  }\n}',
      ),
    ],
    [
      "augmentation-isolation",
      fence(
        'import type { Scene } from "@yagejs/core";\ndeclare const scene: Scene;\nscene.snippetOnlyField;',
      ),
    ],
    [
      "reference-declaration",
      fence('/// <reference types="vite/client" />\nimport.meta.env.DEV;'),
    ],
    ["reference-isolation", fence("import.meta.env.DEV;")],
    [
      "package-augmentation",
      fence(
        'import { Scene } from "@yagejs/core";\nclass Cave extends Scene {\n  readonly name = "cave";\n  readonly lighting = { bounce: { strength: 1, radius: 1, blend: "max" } };\n}',
      ),
    ],
    [
      "group",
      fence(
        "export const value = 3;",
        'yage-group="sample" yage-file="values.ts"',
      ) +
        "\n\n" +
        fence(
          'import { value } from "./values.js";\nconst actual: number = value;',
          'yage-group="sample" yage-file="main.ts"',
        ),
    ],
    [
      "mapping",
      "# Heading\n\n" +
        fence("const a = 1;", 'yage-group="sample" yage-context="async"') +
        "\n\n" +
        fence(
          "const b: string = 3;",
          'yage-group="sample" yage-context="async"',
        ),
    ],
    [
      "conflict",
      fence("const a = 1;", 'yage-group="sample"') +
        "\n\n" +
        fence("const b = 2;", 'yage-group="sample" yage-context="entity"'),
    ],
    [
      "reordered",
      fence("entity.id;", 'yage-group="sample" yage-context="entity,async"') +
        "\n\n" +
        fence("entity.id;", 'yage-group="sample" yage-context="async,entity"'),
    ],
    [
      "check-conflict",
      fence("const a = 1;", 'yage-group="sample"') +
        "\n\n" +
        fence(
          "const b = 2;",
          'yage-group="sample" yage-check="syntax" yage-reason="Game-local algorithm with intentionally unspecified game contracts."',
        ),
    ],
    [
      "blocked-group",
      fence("const broken = ;", 'yage-group="sample" yage-file="a.ts"') +
        "\n\n" +
        fence("const b = 2;", 'yage-group="sample" yage-file="b.ts"'),
    ],
    [
      "browser",
      fence("window.__yage__.inspector.getErrors();", 'yage-context="browser"'),
    ],
    [
      "playwright",
      fence(
        'await page.goto("/");\nexpect(1).toBe(1);',
        'yage-context="playwright"',
      ),
    ],
    [
      "vitest",
      fence(
        'test("example", () => expect(1).toBe(1));',
        'yage-context="vitest"',
      ),
    ],
  ].map(([name, text]) => ({ file: `${name}.md`, text }));
  const report = checkDocuments(documents);
  const named = (name) =>
    report.snippets.filter((snippet) => snippet.file === `${name}.md`);
  const codes = (name) =>
    named(name).flatMap((snippet) =>
      snippet.diagnostics.map((diagnostic) => diagnostic.code),
    );
  for (const name of [
    "valid",
    "side-effect-valid",
    "host",
    "component",
    "scene",
    "inline-import",
    "expectation-string",
    "augmentation-declaration",
    "reference-declaration",
    "group",
    "reordered",
    "browser",
    "playwright",
    "vitest",
  ])
    assert.ok(
      named(name).every((snippet) => snippet.status === "checked"),
      `${name}: ${JSON.stringify(named(name))}`,
    );
  assert.ok(codes("option").includes(2353));
  assert.ok(codes("syntax").includes(1109));
  assert.ok(codes("semantic").includes(2322));
  assert.equal(named("negative")[0].status, "negative");
  assert.ok(codes("stale").includes("expectation"));
  assert.deepEqual(codes("unrelated"), [2322]);
  assert.ok(codes("import").includes(2305));
  assert.ok(codes("side-effect-missing").includes(2307));
  assert.ok(codes("side-effect-unknown").includes(2307));
  assert.ok(codes("tsx").includes(2322));
  assert.equal(named("syntax-only")[0].status, "syntax-only");
  assert.equal(report.counts["syntax-only"], 1);
  assert.ok(codes("missing-context").includes(2304));
  assert.ok(codes("duplicate-context").includes("directive"));
  assert.ok(codes("suppression").includes("directive"));
  for (const name of ["block-suppression", "block-expectation", "no-check"])
    assert.ok(codes(name).includes("directive"), name);
  assert.deepEqual(codes("suppression-string"), [2322]);
  assert.ok(codes("global-isolation").includes(2304));
  // Fences share programs, but one fence's augmentations and references
  // never reach another; a package's own augmentations always apply.
  assert.ok(codes("augmentation-isolation").includes(2339));
  assert.ok(codes("reference-isolation").includes(2339));
  assert.ok(codes("package-augmentation").includes(2416));
  const isolated = checkDocuments(documents, { batchSize: 1 });
  assert.deepEqual(
    isolated.snippets.map(({ status, diagnostics }) => ({
      status,
      codes: diagnostics.map(({ code }) => code),
    })),
    report.snippets.map(({ status, diagnostics }) => ({
      status,
      codes: diagnostics.map(({ code }) => code),
    })),
  );
  assert.ok(codes("conflict").includes("directive"));
  assert.equal(named("reordered").length, 2);
  assert.ok(codes("check-conflict").includes("directive"));
  assert.equal(named("mapping")[1].diagnostics[0].line, 8);
  assert.equal(named("blocked-group")[1].status, "error");
  assert.ok(codes("blocked-group").includes("syntax-group"));
  assert.equal(
    report.counts.total,
    report.counts.checked +
      report.counts.negative +
      report.counts["syntax-only"] +
      report.counts.error,
  );
  assert.equal(report.errors.length, 0);
});

test("Markdown and MDX AST extraction includes quoted and nested fences", () => {
  const markdown =
    "> ```ts\n> const a = 1;\n> ```\n\n- Example:\n\n  ```typescript\n  const b = 2;\n  ```";
  const blocks = extractSnippets(markdown, "nested.md");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].line, 1);
  assert.equal(blocks[1].line, 7);
  const mdx =
    "<Tabs>\n\n" + fence("const a = <div />;", "", "tsx") + "\n\n</Tabs>";
  assert.equal(extractSnippets(mdx, "nested.mdx").length, 1);
});

test("illustrative imports are explicit, typed, group-local and cannot replace visible files", (context) => {
  const fixturesRoot = mkdtempSync(join(tmpdir(), "yage-snippet-fixtures-"));
  context.after(() => rmSync(fixturesRoot, { recursive: true, force: true }));
  mkdirSync(join(fixturesRoot, "game"));
  writeFileSync(
    join(fixturesRoot, "game/Bullet.ts"),
    `
import { Entity } from "@yagejs/core";
export declare class Bullet extends Entity {
  setup(params: { damage: number }): void;
}`,
  );
  mkdirSync(join(fixturesRoot, "invalid"));
  writeFileSync(
    join(fixturesRoot, "invalid/Broken.ts"),
    'import type { MissingType } from "@yagejs/core";\nexport declare const broken: MissingType;',
  );
  mkdirSync(join(fixturesRoot, "declaration"));
  writeFileSync(
    join(fixturesRoot, "declaration/Broken.d.ts"),
    "export declare const broken: MissingType;",
  );
  const code =
    'import { Bullet } from "./Bullet.js";\nscene.spawn(Bullet, { damage: 5 });';
  const report = checkDocuments(
    [
      {
        file: "valid.md",
        text: fence(code, 'yage-fixture="game" yage-context="scene"'),
      },
      {
        file: "wrong.md",
        text: fence(
          code.replace("damage: 5", 'damage: "five"'),
          'yage-fixture="game" yage-context="scene"',
        ),
      },
      { file: "isolated.md", text: fence(code, 'yage-context="scene"') },
      {
        file: "missing.md",
        text: fence(code, 'yage-fixture="missing" yage-context="scene"'),
      },
      {
        file: "group.md",
        text:
          fence(
            "export const damage = 5;",
            'yage-group="shot" yage-file="config.ts" yage-fixture="game"',
          ) +
          "\n" +
          fence(
            'import { damage } from "../config.js";\nimport { Bullet } from "../Bullet.js";\nscene.spawn(Bullet, { damage });',
            'yage-group="shot" yage-file="weapon/main.ts" yage-context="scene"',
          ),
      },
      {
        file: "collision.md",
        text: fence(
          "export const Bullet = 1;",
          'yage-group="shot" yage-file="Bullet.ts" yage-fixture="game"',
        ),
      },
      {
        file: "invalid.md",
        text: fence("const value = 1;", 'yage-fixture="invalid"'),
      },
      {
        file: "declaration.md",
        text: fence("const value = 1;", 'yage-fixture="declaration"'),
      },
      {
        file: "conflict.md",
        text:
          fence("const a = 1;", 'yage-group="shot" yage-fixture="game"') +
          "\n" +
          fence("const b = 1;", 'yage-group="shot" yage-fixture="invalid"'),
      },
    ],
    { fixturesRoot },
  );
  const snippets = (file) =>
    report.snippets.filter((snippet) => snippet.file === file);
  assert.equal(snippets("valid.md")[0].status, "checked");
  assert.ok(
    snippets("group.md").every((snippet) => snippet.status === "checked"),
  );
  assert.ok(
    snippets("wrong.md")[0].diagnostics.some(({ code }) => code === 2769),
  );
  assert.ok(
    snippets("isolated.md")[0].diagnostics.some(({ code }) => code === 2307),
  );
  for (const file of [
    "missing.md",
    "collision.md",
    "conflict.md",
    "declaration.md",
  ])
    assert.ok(
      snippets(file).some((snippet) =>
        snippet.diagnostics.some(({ code }) => code === "directive"),
      ),
      file,
    );
  assert.ok(
    report.errors.some(
      ({ file, code, line }) =>
        file.endsWith("invalid/Broken.ts") && code === 2305 && line === 1,
    ),
  );
});

test("built React props allow optional resets without loosening required or nested props", () => {
  const cases = [
    [
      "jsx-resets",
      `import { Panel, Button } from "@yagejs/ui-react";
const panel = <Panel bg={undefined} width={undefined} />;
const button = <Button onClick={undefined} />;`,
    ],
    [
      "exported-resets",
      `import type { PanelProps, ButtonProps } from "@yagejs/ui-react";
const panel: PanelProps = { bg: undefined, width: undefined };
const button: ButtonProps = { onClick: undefined };`,
    ],
    [
      "required-bg",
      `import { PixiProgressBar } from "@yagejs/ui-react";
const element = <PixiProgressBar bg={undefined} fill="fill.png" />;`,
    ],
    [
      "required-fill",
      `import { PixiProgressBar } from "@yagejs/ui-react";
const element = <PixiProgressBar bg="background.png" fill={undefined} />;`,
    ],
    [
      "required-content",
      `import { Tooltip } from "@yagejs/ui-react";
const element = <Tooltip>Target</Tooltip>;`,
    ],
    [
      "required-children",
      `import { Tooltip } from "@yagejs/ui-react";
const element = <Tooltip content="Help" />;`,
    ],
    [
      "nested-options",
      `import { Panel } from "@yagejs/ui-react";
const element = <Panel bg={{ color: undefined }} />;`,
    ],
  ];
  const report = checkDocuments(
    cases.map(([name, code]) => ({
      file: `${name}.md`,
      text: fence(code, "", "tsx"),
    })),
  );
  for (const snippet of report.snippets) {
    const expected = snippet.file.endsWith("resets.md") ? "checked" : "error";
    assert.equal(snippet.status, expected, JSON.stringify(snippet));
    if (expected === "error")
      assert.ok(
        snippet.diagnostics.some(({ code }) => typeof code === "number"),
      );
  }
});

test("checker metadata rejects malformed values, escaping files, unknown names and conflicting wrappers", () => {
  for (const value of [
    'yage-unknown="x"',
    'yage-context="invented"',
    'yage-context="type,async"',
    'yage-context="engine,engine"',
    'yage-file="foo.ts"',
    'yage-group="x" yage-file="../outside.ts"',
    'yage-group="x" yage-file="/outside.ts"',
    'yage-check="skip"',
    'yage-check="syntax"',
    'yage-group="x" yage-group="y"',
    'yage-group="unterminated',
    'title="Using yage-context metadata" yage-context',
    'yage-group="example"suffix',
    'yage-fixture="../outside"',
    'yage-fixture="/outside"',
  ])
    assert.throws(() => parseMetadata(value), value);
  assert.deepEqual(parseMetadata(null).contexts, []);
  assert.deepEqual(
    parseMetadata('title="Using yage-context metadata"').contexts,
    [],
  );
  assert.deepEqual(
    parseMetadata('title="Using yage-context metadata" yage-context="entity"')
      .contexts,
    ["entity"],
  );
  assert.equal(
    parseMetadata('title="main.ts" {1-3} yage-context="entity"').contexts[0],
    "entity",
  );
});

test("missing built declarations fail and nested ESM conditions beat CommonJS", (context) => {
  const root = mkdtempSync(join(tmpdir(), "yage-snippet-exports-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "packages/example");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "@yagejs/example",
      exports: {
        ".": {
          import: { development: { types: "./dist/index.d.ts" } },
          require: { types: "./dist/index.d.cts" },
        },
        "./extra": { import: { types: "./dist/extra.d.ts" } },
      },
    }),
  );
  assert.throws(
    () => declarationEntries(root),
    /Missing built declaration for @yagejs\/example/,
  );
  mkdirSync(join(directory, "dist"));
  writeFileSync(join(directory, "dist/index.d.ts"), "export {};");
  writeFileSync(join(directory, "dist/extra.d.ts"), "export {};");
  assert.deepEqual(Object.keys(declarationEntries(root)), [
    "@yagejs/example",
    "@yagejs/example/extra",
  ]);
});
