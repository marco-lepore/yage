import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkAddonContextRegistration,
  checkClockOptionTypes,
  checkComposedEntityLiveness,
  checkCoreEventBusKeys,
  checkInlineImportTypes,
  checkPackageImportBoundaries,
  checkRemovedDestroyEntity,
  checkRemovedOnRemove,
  checkServiceKeyOwnership,
  checkSystemDocParity,
  checkVec2VoidMethods,
  loadRepositoryPackages,
  positiveControlFailures,
} from "./measure.mjs";

const file = (path, code) => ({ path, code });
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readRepositoryFile(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

test("every repository check has a passing synthetic positive control", () => {
  assert.deepEqual(positiveControlFailures(), []);
});

test("system parity resolves an inherited priority and checks both documents", () => {
  const sourceFiles = [
    file(
      "packages/core/src/Systems.ts",
      `
        abstract class System { abstract readonly phase: Phase; readonly priority = 0; }
        abstract class BaseUpdateSystem extends System { readonly priority = 12; }
        export class FirstSystem extends BaseUpdateSystem { readonly phase = Phase.Update; }
      `,
    ),
  ];
  const llm = "- `Update`: `FirstSystem (12, core)`";
  const human = "| **Update** | `FirstSystem` (12, core) |";
  assert.deepEqual(
    checkSystemDocParity({
      sourceFiles,
      documents: [file("a.md", llm), file("b.mdx", human)],
    }),
    [],
  );
  assert.equal(
    checkSystemDocParity({
      sourceFiles,
      documents: [
        file("a.md", llm),
        file("b.mdx", "| **LateUpdate** | `FirstSystem` (12, core) |"),
      ],
    }).length,
    2,
  );
});

test("system inheritance resolves imports without borrowing same-named classes", () => {
  const sourceFiles = [
    file(
      "packages/first/src/Base.ts",
      `
        abstract class System { abstract readonly phase: Phase; readonly priority = 0; }
        export abstract class Base extends System { readonly priority = 12; }
      `,
    ),
    file(
      "packages/second/src/Base.ts",
      `
        abstract class System { abstract readonly phase: Phase; readonly priority = 0; }
        export abstract class Base extends System { readonly priority = 99; }
      `,
    ),
    file(
      "packages/first/src/FirstSystem.ts",
      `
        import { Base } from "./Base.js";
        export class FirstSystem extends Base { readonly phase = Phase.Update; }
      `,
    ),
  ];
  const row = "- `Update`: `FirstSystem (12, first)`";
  assert.deepEqual(
    checkSystemDocParity({
      sourceFiles,
      documents: [file("a.md", row), file("b.mdx", row)],
    }),
    [],
  );
});

test("clock options accept only the shared clock contracts", () => {
  const errors = checkClockOptionTypes([
    file(
      "packages/core/src/options.ts",
      `
        export interface ProcessOptions { clock?: ProcessClock }
        export type InputOptions = { clock?: InputClock | undefined };
        export interface BadOptions { clock: "frame" | "fixed" }
        interface InternalOptions { clock: number }
        export interface NotAConfig { clock: number }
      `,
    ),
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /BadOptions/);
});

test("ServiceKey duplicates require an explanation only at non-owning declarations", () => {
  const owned = file(
    "packages/input/src/types.ts",
    'export const InputKey = new ServiceKey<string>("input");',
  );
  assert.deepEqual(
    checkServiceKeyOwnership([
      owned,
      file(
        "packages/addons/demo/src/key.ts",
        '// @yagejs/input owns this well-known service id.\nconst Key = new ServiceKey<string>("input");',
      ),
    ]),
    [],
  );
  assert.equal(
    checkServiceKeyOwnership([
      owned,
      file(
        "packages/addons/demo/src/key.ts",
        'const Key = new ServiceKey<string>("input");',
      ),
    ]).length,
    1,
  );
});

test("package import boundaries cover nested packages and runtime declarations", () => {
  const errors = checkPackageImportBoundaries([
    {
      directory: "packages/addons/demo",
      manifest: {
        name: "@yagejs-addons/demo",
        dependencies: { "runtime-dependency": "1.0.0" },
        peerDependencies: { "runtime-peer": "1.0.0" },
        devDependencies: {
          "type-only-dependency": "1.0.0",
          "undeclared-at-runtime": "1.0.0",
          "mixed-dev-only": "1.0.0",
          "equals-type-dependency": "1.0.0",
          "equals-value-dev-only": "1.0.0",
        },
      },
      files: [
        file(
          "packages/addons/demo/src/index.ts",
          `
            import runtime from "runtime-dependency/subpath";
            export { runtimeValue } from "runtime-peer";
            import type { TypeOnly } from "type-only-dependency";
            import { type AnotherType } from "type-only-dependency";
            export type { ExportedType } from "type-only-dependency";
            export { type OtherExportedType } from "type-only-dependency";
            import { readFile } from "node:fs";
            import { join } from "path";
            import local from "./local.js";
            import missing from "undeclared-at-runtime";
            import { type MixedType, mixedValue } from "mixed-dev-only";
            import type EqualsType = require("equals-type-dependency");
            import EqualsValue = require("equals-value-dev-only");
          `,
        ),
      ],
    },
    {
      directory: "packages/tools/example",
      manifest: {
        name: "@yagejs-tools/example",
        peerDependencies: { "dynamic-peer": "1.0.0" },
      },
      files: [
        file(
          "packages/tools/example/src/index.ts",
          'export async function load() { return import("dynamic-peer/loader"); }',
        ),
      ],
    },
  ]);

  assert.equal(errors.length, 3);
  assert.match(
    errors.map((error) => error.message).join("\n"),
    /undeclared-at-runtime/,
  );
  assert.match(
    errors.map((error) => error.message).join("\n"),
    /Runtime import "mixed-dev-only"/,
  );
  assert.match(
    errors.map((error) => error.message).join("\n"),
    /Runtime import "equals-value-dev-only"/,
  );
});

test("type-only imports must name a declared package", () => {
  const errors = checkPackageImportBoundaries([
    {
      directory: "packages/demo",
      manifest: { name: "@yagejs/demo" },
      files: [
        file(
          "packages/demo/src/index.ts",
          'import type { MissingType } from "undeclared-type-only";',
        ),
      ],
    },
  ]);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Type-only import "undeclared-type-only"/);
});

test("node-prefixed builtins do not allow similarly named bare packages", () => {
  const errors = checkPackageImportBoundaries([
    {
      directory: "packages/demo",
      manifest: { name: "@yagejs/demo" },
      files: [
        file(
          "packages/demo/src/index.ts",
          `
            import test from "node:test";
            import bareTest from "test";
          `,
        ),
      ],
    },
  ]);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Runtime import "test"/);
});

test("dynamic imports with attributes follow runtime dependency rules", () => {
  const errors = checkPackageImportBoundaries([
    {
      directory: "packages/demo",
      manifest: {
        name: "@yagejs/demo",
        peerDependencies: { "declared-json": "1.0.0" },
      },
      files: [
        file(
          "packages/demo/src/index.ts",
          `
            const declared = import("declared-json", { with: { type: "json" } });
            const missing = import("undeclared-json", { with: { type: "json" } });
          `,
        ),
      ],
    },
  ]);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Runtime import "undeclared-json"/);
});

test("inline import types must name a declared package", () => {
  const errors = checkPackageImportBoundaries([
    {
      directory: "packages/demo",
      manifest: {
        name: "@yagejs/demo",
        devDependencies: { "declared-inline-type": "1.0.0" },
      },
      files: [
        file(
          "packages/demo/src/index.ts",
          `
            type Declared = import("declared-inline-type").Declared;
            type Missing = import("undeclared-inline-type").Missing;
          `,
        ),
      ],
    },
  ]);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Type-only import "undeclared-inline-type"/);
});

test("repository package discovery reaches nested addons and tools", (context) => {
  const root = mkdtempSync(join(tmpdir(), "yage-measure-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const fixtures = [
    {
      directory: join(root, "packages/addons/demo"),
      name: "@yagejs-addons/demo",
      source: 'import missing from "missing-addon-runtime";',
    },
    {
      directory: join(root, "packages/tools/demo"),
      name: "@yagejs-tools/demo",
      source: 'import type { Missing } from "missing-tool-type";',
    },
  ];
  for (const fixture of fixtures) {
    mkdirSync(join(fixture.directory, "src"), { recursive: true });
    writeFileSync(
      join(fixture.directory, "package.json"),
      JSON.stringify({ name: fixture.name }),
    );
    writeFileSync(join(fixture.directory, "src/index.ts"), fixture.source);
  }

  const packages = loadRepositoryPackages(root);
  assert.deepEqual(
    packages.map((packageInfo) => packageInfo.directory).sort(),
    ["packages/addons/demo", "packages/tools/demo"],
  );

  const errors = checkPackageImportBoundaries(packages);
  assert.equal(errors.length, 2);
  assert.match(
    errors.map((error) => error.message).join("\n"),
    /missing-addon-runtime/,
  );
  assert.match(
    errors.map((error) => error.message).join("\n"),
    /missing-tool-type/,
  );
});

test("tilemap keeps its physics adapter behind the optional physics entry", () => {
  const manifest = JSON.parse(
    readRepositoryFile("packages/tilemap/package.json"),
  );
  const rootEntry = readRepositoryFile("packages/tilemap/src/index.ts");
  const physicsEntry = readRepositoryFile("packages/tilemap/src/physics.ts");
  const buildConfig = readRepositoryFile("packages/tilemap/tsup.config.ts");

  assert.doesNotMatch(rootEntry, /toPhysicsColliders|@yagejs\/physics/);
  assert.match(physicsEntry, /toPhysicsColliders/);
  assert.deepEqual(manifest.exports["./physics"], {
    import: {
      types: "./dist/physics.d.ts",
      default: "./dist/physics.js",
    },
    require: {
      types: "./dist/physics.d.cts",
      default: "./dist/physics.cjs",
    },
  });
  assert.equal(
    manifest.peerDependencies["@yagejs/physics"],
    ">=0.10.4 <0.11.0",
  );
  assert.equal(manifest.peerDependenciesMeta["@yagejs/physics"].optional, true);
  assert.equal(manifest.devDependencies["@yagejs/physics"], "^0.10.4");
  assert.match(buildConfig, /"src\/physics\.ts"/);
});

test("removed lifecycle checks ignore comments and flag code", () => {
  const comments = file(
    "packages/core/src/a.ts",
    "// destroyEntity and onRemove are historical names\nconst ok = true;",
  );
  assert.deepEqual(checkRemovedDestroyEntity([comments]), []);
  assert.deepEqual(checkRemovedOnRemove([comments]), []);
  assert.equal(
    checkRemovedDestroyEntity([
      file("packages/core/src/a.ts", "scene.destroyEntity(entity);"),
    ]).length,
    1,
  );
  assert.equal(
    checkRemovedOnRemove([
      file("packages/core/src/a.ts", "component.onRemove();"),
    ]).length,
    1,
  );
});

test("composed entity liveness handles both equivalent boolean forms", () => {
  const errors = checkComposedEntityLiveness([
    file(
      "packages/core/src/a.ts",
      `
        if (entity.isDestroyed || !entity.isActive) return;
        if (entity.isActive && !entity.isDestroyed) work();
        if (entity.isDestroyed || entity.generation !== expected) return;
        if (primary.isDestroyed || !secondary.isActive) return;
      `,
    ),
  ]);
  assert.equal(errors.length, 2);
});

test("addon DI registration check is scoped to context receivers and addon source", () => {
  assert.equal(
    checkAddonContextRegistration([
      file(
        "packages/addons/demo/src/a.ts",
        `
          context.register(Key, value);
          this.context.registerScoped(Key, value);
          pluginContext.register(Key, value);
          registry.register(value);
          this.registry.registerScoped(Key, value);
        `,
      ),
      file("packages/core/src/a.ts", "context.register(Key, value);"),
    ]).length,
    3,
  );
});

test("inline import type check ignores dynamic imports and JSDoc links", () => {
  const errors = checkInlineImportTypes([
    file(
      "packages/core/src/a.ts",
      `
        /** See import("./doc.js").Doc. */
        const module = await import("./runtime.js");
        let value: import("./value.js").Value;
        // This inline import avoids an unavoidable circular type dependency.
        type Cycle = import("./cycle.js").Cycle;
      `,
    ),
  ]);
  assert.equal(errors.length, 1);
});

test("Vec2 void check is limited to Vec2 source files", () => {
  assert.equal(
    checkVec2VoidMethods([
      file("packages/core/src/Vec2.ts", "class Vec2 { mutate(): void {} }"),
      file("packages/core/src/Other.ts", "class Other { mutate(): void {} }"),
    ]).length,
    1,
  );
});

test("core event bus keys come from EngineEvents and ignore other emitters", () => {
  const errors = checkCoreEventBusKeys([
    file(
      "packages/core/src/EventBus.ts",
      'export interface EngineEvents { "known:event": undefined }',
    ),
    file(
      "packages/core/src/Engine.ts",
      `
        events.emit("known:event", undefined);
        this.events.emit("missing:event", undefined);
        eventBus.emit("other:missing", undefined);
        this.eventBus.emit("third:missing", undefined);
        entity.emit("component:event", undefined);
        this.entity.emit("component:event", undefined);
      `,
    ),
  ]);
  assert.equal(errors.length, 3);
  assert.match(
    errors.map((error) => error.message).join("\n"),
    /missing:event/,
  );
});
