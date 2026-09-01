# @yagejs/level

Depends on `@yagejs/core`. Loads authored level files — `*.yage-level.json`
documents holding entity placements, their setup parameters, hierarchy, active
state, and local transforms.

A level file holds no scene code and no runtime component state. It says which
entity types to create, with what parameters, where, and under which parent.

## The four steps

```ts
import raw from "./levels/forest.yage-level.json";
import {
  buildLevelCatalog,
  instantiateLevel,
  levelAssets,
  prepareLevel,
  readLevel,
} from "@yagejs/level";
import levelProject from "./levelProject.js";

const built = buildLevelCatalog(levelProject);
if (!built.ok) throw new Error(built.errors[0].message);

const read = readLevel(raw); // strict structural parse
if (!read.ok) throw new Error(read.errors[0].message);

const forest = prepareLevel(read.document, built.catalog); // semantic check + migrations
```

1. `readLevel(source)` — structural parse. `source` is the file's text or JSON
   already through `JSON.parse` (an import, a fetch body).
2. `prepareLevel(document, catalog)` — checks types and parameters against the
   catalog, runs parameter migrations, derives assets. Reports, never throws.
3. `levelAssets(prepared)` — the handles a scene must preload.
4. `instantiateLevel(scene, prepared, options)` — creates the entities.

Steps 1–3 are pure and run once, outside the scene. Only step 4 touches a
scene, and it is the one that throws.

## Declaring placeable entities

```ts
import { Entity, Transform, Vec2 } from "@yagejs/core";
import {
  defineLevelAsset,
  defineLevelEntity,
  defineParams,
  param,
  type ParamsOf,
} from "@yagejs/level";
import { SpriteComponent, texture } from "@yagejs/renderer";

const textureAsset = defineLevelAsset({ kind: "texture", create: texture });

const CrateParams = defineParams({
  sprite: param.asset(textureAsset, "sprites/crate.png"),
});

export class Crate extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.crate",
    version: 1,
    params: CrateParams,
  });

  setup(params: ParamsOf<typeof CrateParams>): void {
    this.add(new Transform());
    this.add(new SpriteComponent({ texture: params.sprite }));
  }
}
```

- The `static level` declaration is what makes a class placeable. `id` is what
  a level file stores; renaming the class does not change a saved level.
- `version` is the parameter schema's version. A level records the version its
  parameters were authored against, and `migrations` moves them forward.
- `param.asset(descriptor, defaultPath)` is the one parameter kind. The
  authored value is a project-relative POSIX path; `setup()` receives the
  `AssetHandle` the descriptor built.
- `defineLevelAsset({ kind, create })` says how a path becomes a handle. The
  `create` function comes from the plugin that owns the asset — `texture` from
  `@yagejs/renderer` — and must be deterministic.
- Declaring never throws. A bad id, version, migration key, or default is
  reported by `buildLevelCatalog()`, so a tool can list the problem and keep
  working.

## The project

```ts
import { defineLevelProject } from "@yagejs/level";
import { Crate } from "./Crate.js";
import { Torch } from "./Torch.js";

export default defineLevelProject({ entities: [Crate, Torch] });
```

`buildLevelCatalog(project)` turns it into the catalog preparation needs:

```ts
type CatalogResult =
  | { ok: true; catalog: LevelCatalog }
  | { ok: false; errors: readonly CatalogError[] };
```

All or nothing: one bad declaration produces no partial catalog. A duplicate
entity type id is an error — two declarations of one id would let one
declaration's schema migrate placements authored against the other.

## Loading into a scene

```ts
class ForestScene extends Scene {
  readonly preload = levelAssets(forest);
  private level?: LevelInstance;

  onEnter(): void {
    this.level = instantiateLevel(this, forest, { namespace: "forest" });
  }

  onExit(): void {
    for (const handle of this.preload) this.assets.unload(handle);
  }
}
```

`InstantiateLevelOptions`:

| Field        | Meaning                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| `namespace`  | Required. Prefixes every scene key this load derives. No `/`, not empty.     |
| `transform`  | Composes into every top-level placement. No root entity is created.          |
| `activation` | `"deferred"` leaves the entities inactive; call `instance.activate()` later. |

Loading is strict and all-or-nothing:

- A prepared level carrying any diagnostic is refused outright.
- A failure while building throws `LevelLoadError` and leaves the scene
  untouched — the spawn batch rolls back before it publishes.
- An activation failure disposes the instance it had already committed.

Every entity is reserved before any `setup()` runs, so a setup parameter can
hold a handle to a placement further down the document and the authored parent
links exist before setup can read them.

`LevelLoadError` carries `documentId`, `placementId`, `typeId`, `path`, and
`diagnostics` where they apply.

Two instances of one level, or two levels, coexist in one scene as long as
their namespaces differ.

`LevelInstance`:

```ts
instance.id; // the document id
instance.get(placementId); // Entity | undefined
instance.entities; // readonly Entity[], parent before child
instance.activate(); // after activation: "deferred"; throws if already activated
instance.dispose(); // destroys this instance's entities and nothing else
instance.isDisposed;
```

## Validation without loading

```ts
import { validateLevel } from "@yagejs/level";

const problems = validateLevel(document, catalog); // readonly LevelDiagnostic[]
```

Every problem only a catalog can find: an unknown type, parameters that do not
match a declaration, a version no migration reaches. This is `prepareLevel`
asked for its diagnostics alone — a tool that revalidates after every edit uses
it; a game calls `prepareLevel` once and loads the result.

Each problem has a stable `code`:

```ts
type LevelDiagnosticCode =
  | "unknown-type"
  | "migration-failed"
  | "parameter-invalid"
  | "asset-derivation-failed";
```

Use the code and parameter `path` when a tool offers a corrective action. The
message is for display. Every level diagnostic is an error that blocks strict
loading; there is no warning severity.

## Creating a placement in a tool

```ts
import { defaultParams } from "@yagejs/level";

const entry = catalog.get("game.crate");
const placement: LevelPlacement = {
  id: crypto.randomUUID(),
  type: entry.id,
  typeVersion: entry.declaration.version,
  active: true,
  transform: { position: { x, y }, rotation: 0, scale: { x: 1, y: 1 } },
  params: entry.declaration.params
    ? defaultParams(entry.declaration.params)
    : {},
  extensions: {},
};
```

`defaultParams(schema)` is every field at the default its kind declares. A tool
that creates placements calls it once, at creation, and writes the result into
the document — that is what makes a later change to a declaration's default
leave existing levels alone.

The values are the declaration's own defaults rather than copies. Every
parameter kind is string-valued, so nothing shares mutable state; a kind whose
default is an object or an array has to copy before two placements can hold
one.

`describeParams(schema)` returns the data an authoring tool needs to render the
schema without receiving its validators, decoders, or asset factories:

```ts
import { describeParams } from "@yagejs/level";

const fields = entry.declaration.params
  ? describeParams(entry.declaration.params)
  : [];
// [{
//   name: "sprite",
//   kind: "asset",
//   assetKind: "texture",
//   defaultValue: "sprites/crate.png",
// }]
```

The returned list and its entries are immutable and follow declaration order.
Parameter kinds are built through `param`; hand-built kind objects are rejected
when the catalog is built.

`kind` says which control the field needs and is a closed set — `"asset"` is
the only one — so a tool can switch on it exhaustively. `assetKind` is the
`kind` of the descriptor `param.asset()` was given and is open, because
`defineLevelAsset` is yours: match the kinds you know (`"texture"` for the
descriptor built over the renderer's `texture()`) and treat the rest as paths.

## The document layer alone

```ts
import { formatLevel, readLevel } from "@yagejs/level/document";
```

`@yagejs/level/document` is the parser and the canonical writer with no
dependency on `@yagejs/core`, so a Node tool can read and rewrite level files
without evaluating engine code. `formatLevel(document)` returns the one
canonical text for a document: the same document always produces the same
bytes, and reading them back produces the same document.

Structural errors are returned, never thrown, and all of them are collected:

```ts
type StructuralResult =
  | { ok: true; document: LevelDocument }
  | { ok: false; errors: readonly StructuralError[] }; // { path, message }
```

Structural means what a document can be checked for on its own: field shapes,
finite numbers, unique ids, a parent hierarchy that is a tree. Whether `type`
names an entity that exists is a question for a catalog.

## Gotchas

- A placement that omits a parameter is an error, not a default. Defaults are
  written when a placement is created, so changing a default later cannot
  silently change an existing level.
- `levelAssets()` deduplicates by loader type and path, which is the key
  `AssetManager` counts references by. Pass its result to `preload` as-is.
- A placement's authored `name` does not reach `Entity.name`; the entity is
  named after its class.
- The barrel re-exports the document layer, so a game needs one import. The
  `/document` subpath exists for code that must not pull in `@yagejs/core`.
