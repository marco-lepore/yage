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
- `param.asset(descriptor, defaultPath, frames?)` names a project asset. The
  authored value is a project-relative POSIX path; `setup()` receives the
  `AssetHandle` the descriptor built, with or without `frames`.
- `param.entityRef({ types, optional? })` names another placement in the same
  level. See [Pointing at another placement](#pointing-at-another-placement).
- The plain kinds carry the numbers, switches, names and choices a type needs.
  See [Numbers, switches, names and choices](#numbers-switches-names-and-choices).
- `param.vec2(default, options?)` and `param.point(default, options?)` carry a
  pair of numbers. See [Pairs and places](#pairs-and-places).
- `frames` is an `AssetFrames`: how the named file is cut into a grid. Declare
  it only for a parameter naming a sheet the type slices. Its members are the
  renderer's `TextureSliceOptions`, so state the grid once and spread the same
  object into the frame source:

  ```ts
  const TORCH_FRAMES = { frameWidth: 48 };

  const TorchParams = defineParams({
    sprite: param.asset(textureAsset, "assets/torch.png", TORCH_FRAMES),
  });

  setup(params: ParamsOf<typeof TorchParams>): void {
    this.add(
      new AnimatedSpriteComponent({
        source: { sheet: params.sprite.path, ...TORCH_FRAMES },
      }),
    );
  }
  ```

  It is authoring data: it reaches tools through `describeParams()` and changes
  nothing about the path, the decoded handle, or the level file. A grid the
  renderer could not slice with — a `frameWidth` below 1, a negative `startX` —
  is reported by `buildLevelCatalog()` rather than thrown.

- `defineLevelAsset({ kind, create })` says how a path becomes a handle. The
  `create` function comes from the plugin that owns the asset — `texture` from
  `@yagejs/renderer` — and must be deterministic.
- Declaring never throws. A bad id, version, migration key, or default is
  reported by `buildLevelCatalog()`, so a tool can list the problem and keep
  working.

## Numbers, switches, names and choices

```ts
const SlimeParams = defineParams({
  speed: param.number(40, { min: 5, max: 200, step: 5 }),
  coins: param.integer(3, { min: 0 }),
  awake: param.boolean(true),
  title: param.string("Slime"),
  notes: param.string("", { multiline: true, optional: true }),
  facing: param.select("left", ["left", "right"]),
});

setup(params: ParamsOf<typeof SlimeParams>): void {
  // speed: number, coins: number, awake: boolean, title: string,
  // notes: string | undefined, facing: "left" | "right"
}
```

```ts
param.number(defaultValue: number, options?: {
  min?: number; max?: number; step?: number; optional?: boolean;
}): ParamKind<number>
param.integer(defaultValue: number, options?: {
  min?: number; max?: number; optional?: boolean;
}): ParamKind<number>
param.boolean(defaultValue: boolean, options?: { optional?: boolean }): ParamKind<boolean>
param.string(defaultValue: string, options?: {
  multiline?: boolean; optional?: boolean;
}): ParamKind<string>
param.select<const O extends readonly string[]>(
  defaultValue: O[number],
  values: O,
  options?: { optional?: boolean },
): ParamKind<O[number]>
```

- The authored JSON is the value itself: a number, `true` or `false`, a string,
  or one of the listed strings. The level file stores what `setup()` receives.
- `param.select` reads its values literally, so `setup()` receives the union
  `"left" | "right"` and a `switch` over it is exhaustive.
- `integer` is a kind of its own rather than an option on `number`: `2.5` in a
  file is reported, never rounded.
- `min` and `max` are checked when the level is prepared, so a value outside
  them is a finding on that placement. `step` and `multiline` are authoring
  data — they size a control's presses and its box, and validate nothing.
- `optional: true` makes `null` a value: `setup()` receives `undefined`, and
  the declared type becomes `number | undefined` and so on. A missing key stays
  an error whether or not the field is optional, so a placement that holds
  nothing says so.

## Pairs and places

```ts
const SlimeParams = defineParams({
  drift: param.vec2({ x: 0, y: -12 }),
  patrolEnd: param.point({ x: 120, y: 0 }, { relative: true }),
  muzzle: param.point({ x: 24, y: -6 }, { relative: true, space: "local" }),
  home: param.point({ x: 0, y: 0 }, { optional: true }),
});

setup(params: ParamsOf<typeof SlimeParams>): void {
  // patrolEnd: a world Vec2, wherever the level put this slime
  // muzzle: a Vec2 offset from the slime's own origin
  // home: Vec2 | undefined
}
```

```ts
param.vec2(defaultValue: Vec2Like, options?: { optional?: boolean }): ParamKind<Vec2>
param.point(defaultValue: Vec2Like, options?: {
  relative?: boolean; space?: "world" | "local"; optional?: boolean;
}): ParamKind<Vec2>
```

- The authored JSON is `{ "x": 12, "y": -4 }`: an object with those two members
  and no others, both finite. `setup()` receives a `Vec2` from `@yagejs/core`.
- `vec2` is a pair of numbers — a size, a factor, a velocity. `point` is a
  place, and the level editor draws a handle on it that an author drags.
- `relative: true` stores a `point` in the placement's own frame, so the value
  travels with the placement: move the slime in the editor and its patrol end
  moves too. Without it the value is a world point that stays where it is.
- `space` says which frame `setup()` receives, and defaults to `"world"`. The
  level converts between the two through where the placement ends up in the
  world (the instance transform composed with every parent above it), so a
  relative point arrives as a world position with nothing left to compose.
- `space: "local"` asks for an offset from the placement instead — a muzzle, a
  hardpoint, anything that has to keep following the entity. Turn it into a
  world point where it is used, with `Transform.localToWorld(point)` from a
  component's `onEnable()` or an update, once the level has placed the entity.

## Pointing at another placement

```ts
import { param, defineParams, type ParamsOf } from "@yagejs/level";
import type { EntityHandle } from "@yagejs/core";

const SwitchParams = defineParams({
  door: param.entityRef<Door>({ types: ["game.door"] }),
  chime: param.entityRef<Chime>({ types: ["game.chime"], optional: true }),
});

export class Switch extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.switch",
    version: 1,
    params: SwitchParams,
  });

  private door?: EntityHandle<Door>;

  setup(params: ParamsOf<typeof SwitchParams>): void {
    this.door = params.door; // EntityHandle<Door>
    // params.chime is EntityHandle<Chime> | undefined
    this.add(new SwitchMechanism(this.door));
  }
}
```

- The level file stores the target's placement `id`, or `null` for nothing
  chosen. `defaultParams()` writes `null` for a reference field, required or
  not.
- `types` lists the catalog type ids the field accepts, and must name at least
  one type the project declares — `buildLevelCatalog()` reports both an empty
  list and a type nothing declares. A reference may name a type declared
  further down `entities` or contributed by a package.
- `optional: true` makes `null` a value here and widens what `setup()` receives
  to `EntityHandle<T> | undefined`.
- **Store the handle in `setup()`; read `.current` from a component's
  `onEnable()` or later.** Every placement is reserved before any `setup()`
  runs, so a forward reference and a cycle both resolve — but the target's own
  `setup()` may not have run yet. `LevelInstance.activate()` runs after the
  whole document has set up, so the first `onEnable()` any authored placement
  sees is later than every `setup()`.
- The handle expires when the target entity is destroyed, which is
  `EntityHandle`'s ordinary contract. It never retargets.
- **Saving a reference:** a handle is not part of a save. Persist the target's
  placement id — the same string the level file holds — and resolve it again
  with `LevelInstance.get(id)` after the level loads.

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

## Choosing what draws on top

Inside one layer, draw order is add order, and add order is document order: a
placement listed later draws over one listed earlier. `parentFirst` orders the
build by depth alone, so every child draws over every root on the same layer,
whatever the hierarchy says.

A placement can name the layer its visuals join:

```json
{ "id": "sign", "type": "game.sign", "typeVersion": 1, "layer": "props" }
```

`layer` is optional and moves every visual the entity type left on `"default"`.
A visual whose `setup()` chose a layer of its own — a health bar on `"ui"` —
keeps it. The name must be a layer the scene declares; one no scene declares
logs a dev warning and falls back to `"default"`.

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
  | "asset-derivation-failed"
  | "reference-unset"
  | "reference-missing"
  | "reference-type";
```

The three reference codes are separate from `parameter-invalid` because
resetting a parameter to its default writes "nothing chosen" back and fixes
none of them: `reference-unset` is a required reference holding `null`,
`reference-missing` an id no placement in the document holds, and
`reference-type` a target whose `type` the field does not accept. Each carries
`path: [fieldName]`. They are checked against the authored document, so a
reference to a placement that itself failed to prepare is not a problem.

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

A default that is not a primitive is copied, so two placements created from one
declaration never share an object.

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
//   frames: { frameWidth: 48 },
//   defaultValue: "assets/torch.png",
// }]
```

The returned list and its entries are immutable and follow declaration order.
Parameter kinds are built through `param`; hand-built kind objects are rejected
when the catalog is built.

`kind` says which control the field needs and is a closed set — `"asset"`,
`"entityRef"`, `"number"`, `"integer"`, `"boolean"`, `"string"`, `"select"`,
`"vec2"` and `"point"` — so a tool can switch on it exhaustively.

For an asset field, `assetKind` is the `kind` of the descriptor `param.asset()`
was given and is open, because `defineLevelAsset` is yours: match the kinds you
know (`"texture"` for the descriptor built over the renderer's `texture()`) and
treat the rest as paths. `frames` is present only when the declaration gave
one, and it says what one frame of the default art is, so a tool can show that
frame instead of the whole sheet.

For a reference field, `types` is the frozen list of catalog type ids the field
accepts; `defaultValue` is `null`.

`optional` says whether the field may hold `null`, and is present on every kind
but `asset`, which takes no options object. `defaultValue` is the value the
editor writes into a new placement — a number for a number field and a boolean
for a switch. A number field carries `min`, `max` and `step` when it declared
them, a string field carries `multiline`, a choice field carries `options`, the
frozen list of values it accepts, and a `point` field carries `relative` —
the frame the value is stored in, which is the frame a tool authors in. A
point's `space` is a load-time conversion and is not described.

A prepared placement carries what it points at, so a tool can follow references
without reading a schema:

```ts
interface PlacementReference {
  readonly path: readonly string[]; // parameter path; one segment today
  readonly targetId: string; // in this document, of an accepted type
}
// PreparedPlacement.references: readonly PlacementReference[]
```

It is in field order, and a field holding nothing contributes no entry.

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
- A placement's `layer` reaches the renderer through `VisualComponent.setLayer`,
  which `@yagejs/level` finds by shape rather than by import. A game with no
  renderer has no component that answers it, and the field does nothing.
- The barrel re-exports the document layer, so a game needs one import. The
  `/document` subpath exists for code that must not pull in `@yagejs/core`.
