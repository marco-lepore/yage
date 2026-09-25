# YAGE Addons — Authoring Guide

Audience: **agents building addons** (not consumers). Read this before adding or
changing anything under `packages/addons/`.

## What an addon is

An **addon** is an _installable, opinionated implementation of one cohesive
gameplay pattern_, designed so its opinions are overridable without forking. One
addon = one thing a developer installs by name (dialogue, inventory, combat,
player-controllers, prototype kit).

It is **not** a generic data-structure library, a system with no overrides, or a
mainline plugin. Addons are _gameplay patterns_. Mainline plugins (`core`,
`renderer`, `physics`, …) are _engine infrastructure_, and many games need no
dialogue or inventory at all. Whether something belongs in an addon or in
mainline is a scope decision, not a technical one. If you would describe it as
"a game like X" (an RPG), it is a **template** (a `create-yage` starter), not an
addon.

## The two failure modes

| Failure         | Symptom                                                                               | Root cause                                                          |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Too generic** | User writes as much config as building it themselves; "it's just a `Map` with events" | The addon owns _abstraction_ instead of the fiddly _concrete logic_ |
| **Cornered**    | Works until the user's game differs, then they fork/abandon                           | The addon bakes _domain decisions_ into its _structure_             |

Separate the layers instead of searching for one mid-level abstraction. Each
layer is opinionated at its own level and replaceable on its own. The numbered
rules below apply that separation layer by layer.

## Default render-layer orders

Built-in presenters ensure their configured layers before drawing, including
when mounted standalone. Use the shared renderer `ensureLayer` contract. An
existing host layer keeps its order. In development a mismatch logs one warning
per tree, layer name, and requested order. Do not add a separate warning
registry in an addon.

| Use                                    | Default order range |
| -------------------------------------- | ------------------- |
| Engine UI                              | 1000                |
| Gameplay overlays, including inventory | 1040–1079           |
| Virtual controls                       | 1080–1099           |
| Dialogue screen overlays               | 1100–1199           |

World-space bubble dialogue uses the configured world layer and creates it at
order 0 when absent. The screen-overlay ranges do not apply to world layers.

## The layer model (L0–L3)

An addon uses **only the layers its pattern needs**.

- **L0 Assets**: bundled files such as art, fonts, or themes. Optional. Needs
  `"files": ["dist", "assets"]`. Prefer zero bundled assets where possible.
  Dialogue's default theme uses Graphics plus canvas fonts and bundles nothing.
- **L1 Model**: headless logic, operations, and events. No engine dependencies,
  or `@yagejs/core` only. Fully unit-testable. Never import `@yagejs/renderer` or
  `pixi.js` in the model layer.
- **L2 Engine integration**, in two equal forms. Use either or both:
  - **L2a Component**: per-entity ownership. It hosts the model, forwards model
    events to entity events, integrates save, and may use the engine peers its
    behavior requires, such as physics or input. No setup beyond `entity.add()`;
    `ComponentUpdateSystem` drives it.
  - **L2b Plugin with a System and a Service**: cross-cutting orchestration. A System
    for cross-entity per-frame work, a `ServiceKey` Service for global shared
    state, scene hooks, and DOM, gamepad, or loop setup. The user must call
    `engine.use(...)`. Config and presets pass through the **plugin
    constructor**, as in `InputPlugin` and `AudioPlugin`.
- **L3 View** — presentation behind an interface, with a default presenter,
  reachable only via a `/presenters` subpath so the headless path never imports
  pixi. When the view has several independently-varying parts, **split the
  interface into one narrow channel interface per part** rather than one wide
  presenter (see the channels section below). A single wide presenter is right
  only when the view is one indivisible thing.

### Decision rule — L2a vs L2b

The codebase rule applies: components own game logic, systems handle engine
internals. One-entity state → **Component (L2a)**. Global state, cross-entity
work, loop work, or external IO → **Plugin+System (L2b)**. Many patterns need
**both**; combat uses `Hitbox` components plus an overlap System. A
component-only addon needs no configuration, while a Plugin costs the user an
`engine.use()` line.

### Refinement — host-owned cross-cutting

Touching pause, focus, or global state does not by itself require L2b. When
_which instance is active_ or _whether the world pauses_ is **game policy**,
owning it in a global Service is wrong. That applies especially when several
instances can run at once. Dialogue takes the other route: it ships as an L2a
`Component` the game spawns, exposes `isActive()`, and leaves focus and pause to
the host. Several ambient conversations can run at the same time, and there is
no global singleton. Prefer host-owned cross-cutting when the pattern is
naturally multi-instance, or when the policy belongs to the game.

## Channel interfaces for presentation

When the view has several independently-varying parts, split L3 into one narrow
channel interface per part instead of one wide presenter interface. Dialogue
splits into `TextChannel`, `ChoiceChannel`, `AvatarChannel`, and `ChromeChannel`
(`packages/addons/dialogue/src/core/session.ts`), so the typewriter, choice UI,
portrait, and frame are each swappable and composable. A **composite presenter**
forwards one event stream to several channels. The split is what lets a game
replace the UI without replacing the logic.

## Per-game factory pattern (typed config pinning)

Some addons make the game re-state its typing at every use site: a generic domain
type (rule 3) passes through components, policy functions, def and step
factories, and event payloads. For those, consider exporting a factory the game
calls **once** with its type parameter and full config catalog. The game states
its type once instead of annotating every call site. The factory returns:

- **Retyped def, step, and policy factories** — no per-call-site type
  parameters.
- **New event tokens, created per factory call** and typed to the game's payload,
  so handlers need no narrowing. Entity events dispatch by token _string name_
  (`packages/core/src/Entity.ts`). The factory must therefore namespace event
  names through a required `id` option, and warn in dev mode on duplicate ids.
  Two instances creating tokens with the same name would collide with no error.
- **A bundle component** that mounts the addon's standard sibling stack in
  `onAdd` (`packages/core/src/Component.ts`) and exposes the boundary API. Any
  erasure cast between an unparameterized shared contract (a trait or event
  singleton) and the game's typed model lives inside the bundle, never in game
  code.
- **Id-literal unions derived from the catalog's map keys**, so a mistyped id is
  a compile error. Add eager whole-catalog cross-reference validation that fails
  naming the offending key. Dialogue uses map keys as ids the same way: it sets
  each `SpeakerDef.id` from its `speakers` map key
  (`packages/addons/dialogue/src/core/types.ts`).

The constraint on the pattern: the factory does **assembly and typing only**. No
behavior may exist only through the factory. Everything it returns must be
hand-constructible from the public exports (rule 6). The factory is a preset over
the addon's primitives, not a layer. It lives in the component layer because it
returns L2 assemblies, and the headless core contains no factory.

Boundaries and caveats:

- Traits are class-static (`packages/core/src/Entity.ts`), so neither a factory
  nor a component can attach a trait to its host entity. The `@trait` and
  delegation lines stay in game code. Only a factory-returned base class could
  absorb them, at the cost of the single inheritance slot.
- When the game creates the event tokens through the factory, L3 presenters must
  attach to the factory instance or its tokens, the way dialogue channels attach
  to a session. They must not attach to module-global events.
- Skip the pattern when the addon has no generic domain type and has a
  one-component surface (rule 3's "don't force a `<T>`"). There the factory would
  only rename constructors.

## Rules in, consequences out

- **Rules** the system needs to function correctly (do these stack? can this go
  here? is this choice available?) are **injected as policy**: config values plus
  pure functions.
- **Consequences** in the game (what a potion does, a pickup sound effect, what a
  custom command means) are **emitted as events**.
- When the line between mechanical and game-specific is genuinely blurry, model
  the process as an **ordered pipeline of injectable steps**. Each step has a
  default, each step is replaceable, and events fire at the boundaries. Dialogue
  works this way: the runner owns the `set` flow op, and every other command is
  reported through an `onCommand` handler **and** an event, with optional
  `blocking`/async handling for cinematic sequencing.

## The addon rules

1. **Ship a concrete default, not a framework.** The primary export is an
   opinionated _working_ implementation. A user must be able to install it and
   see it run without writing policy code first.
2. **Opinions are _data and functions_, not _structure_.** Express opinionated
   bits as config values plus injected pure policy functions, never as hardwired
   branches or subclass-only behavior. The user overrides the _policy_, not the
   _structure_.
3. **The domain type is the user's, not yours — for data/state addons.** Be
   generic over the game's type (`Inventory<TItem>`), requiring only a small
   accessor or policy. Behavior addons (controllers, bullet-time) have no domain
   type; they use config, policy hooks, and events. Don't force a `<T>` where
   none belongs.
4. **Layers, each independently usable** (L0–L3 above). An addon uses only the
   layers its pattern needs.
5. **Rules in, consequences out — and when blurry, a pipeline of steps** (above).
6. **Escape hatches at every layer.** Underlying state is readable, documented
   direct-mutation methods exist, and the model is swappable inside the
   component. Never make a convenience wrapper the only way to read or change
   state.
7. **The "would you write this yourself?" test (scoping).** Own the
   annoying-but-non-trivial logic (stack merge/split, slot swap, hitbox overlap,
   save round-trip, typewriter plus branching). Expose a hook for anything
   trivial or game-specific (item balance, what a custom command does). That test
   decides the surface area and avoids both failure modes.

## Theme authoring

A theme is a plain data object (no behavior), serializable, authored inline or
spread-and-tweaked. The rule for what belongs in it is **data vs code**:

- **Theme field, data:** any pure value a built-in renderer consumes, such as a
  color, size, gap, radius, alpha, texture key, or nine-slice insets. Declare it as an
  optional-derived field (`field?`) that falls back to a default when omitted,
  and name the default in the JSDoc (`Omit to derive X`). Keep the interface
  flat, with surface-grouped ordering and section comments. Nested objects
  require a deep-partial resolver to spread-and-tweak, which callers don't have.
- **Render-delegate preset (code):** any new drawing code. Mirror the
  `CellPresenter`/`CellHandle` shape: the view computes rects, placement, and
  hit-tests, and the preset only draws. A custom preset carries its own config by
  closure. A preset still reads the shared palette, font, and layer tokens, so
  one theme change keeps all surfaces consistent. Never add preset-specific
  tokens to the shared theme.
- **View (behavior):** placement, windowing, navigation, hit-tests. All four stay
  hardcoded in the view. To change them, replace the entire view. ±1px alignment
  nudges, shape-geometry constants, and contrast floors are also view-internal,
  because they have no meaning outside the view that uses them.

**Drift-guard:** every addon with a theme factory must have a test that walks the
fully-populated theme to the presenter configs and fails if any field is not
passed through. See `packages/addons/inventory/src/factory/theme.test.ts` for the
sentinel-walk pattern.

## Default font path: canvas, with bitmap fonts opt-in

Default presenters use Graphics chrome plus the canvas `SplitTextComponent` /
`TextComponent`, and bundle no assets. `defaultTheme()` sets no `bitmapFont*`,
`textured`, or portrait fields — only a `fontFamily` plus Graphics colors and
layers. The view selects the path by presence: `font = bitmapFont ?? fontFamily`,
and it uses the bitmap path only when `bitmapFont` is set. Native bold and italic
plus per-glyph tint effects are available on the canvas path. Bitmap fonts
(variant atlases) are an explicit opt-in theme path, never the default. The dialogue addon passes font names as strings and imports no bitmap symbol
by value. When extending the bitmap path, use the names `@yagejs/renderer`'s
barrel exports:
`bitmapFont`, `installBitmapFont`, `BitmapFontVariant`, `resolveTextureInput`,
and `TextureInput`.

## Addon shapes (guidance, NOT encoded in the name)

- **Collection** — many interchangeable pieces, variants, or assets (prototype,
  player-controllers). Usually L0, L2a, and L3, light on L1.
- **Single system** — one cohesive installed system (dialogue, combat). Usually
  L1 plus L2a or L2b, plus L3. _Dialogue's shape:_ L1 headless core, an **L2a
  Component** with the host owning focus and pause, **L3 channel interfaces**,
  and an explicit domain `snapshot()` / `restore()` pair for durable state.
- **Pure library** — headless logic only (stats-formula). L1 only.

A single tiny mechanic such as bullet-time is usually a **recipe or example**, a
copyable snippet rather than a package. Promote it to a package only once reuse
is demonstrated, to avoid sprawl.

## Naming & packaging mechanics

- **Scope:** `@yagejs-addons` (own npm org, separate from engine `@yagejs`).
  Domain-only package names, **no tier suffixes** — the scope is the only
  category marker. `@yagejs-addons/dialogue`, `/inventory`, `/combat`.
- **Export-symbol naming (cross-addon).** Value exports a consumer types into
  game code — bundle factories, action-map presets, default themes — are
  **domain-prefixed** so two addons never collide on an auto-import:
  `dialogueControls`/`inventoryControls`, `DEFAULT_DIALOGUE_ACTIONS`,
  `defaultInventoryTheme`. Interface and class contracts (`InputBinding`,
  `KeyboardInputBinding`, `ChromePresenter`) may stay generic, because a wrong
  import is a compile error rather than a silent hazard, and identical shapes are
  harmless. Event tokens are always domain-prefixed (`DialogueFooEvent`,
  `InventoryFooEvent`). Virtual-controls follows the rule with
  `defaultControlsTheme` and `VIRTUAL_CONTROLS_LAYERS`.
- **Granularity:** one package per addon, each with its own curated dependency
  closure. Subpath exports inside a single package would split _code_ only, not
  _dependencies_ or _versions_.
- **Repo location:** `packages/addons/<domain>/` inside this Turborepo. The npm
  workspaces glob `packages/addons/*` in the root `package.json` picks them up.
  `packages/*` is single-level and does not match the nested path.
- **Versioning:** addons are **independent**. Keep them **out of the engine's
  `fixed` group** in `.changeset/config.json` so an addon release never forces a
  core release, and a core release never forces an addon release. Do not add an
  addon's name to that array; confirm with
  `grep -c "yagejs-addons" .changeset/config.json` returning 0. A new addon's
  changeset is a plain `minor` for that package alone, because the fixed group's
  cascade handles dependents. Use `minor` for initial and feature 0.x releases
  (pre-1.0 rule; never propose 1.0.0). When an engine minor pushes a capped peer
  range out of range, changesets force-bumps the addon by `major` (to `1.0.0` on
  a 0.x package) and opens the peer cap to `>=<engine>`.
  `scripts/clamp-package-versions.mjs` runs inside `version-packages` right after
  `changeset version` and reverses both: it clamps the addon back to a `0.x`
  minor and restores the `<next-minor>` peer cap. Don't hand-fix addon versions
  in the Version Packages PR, because the script handles it.
- **Engine deps as `peerDependencies`** (optional via `peerDependenciesMeta`
  where presentation-only), so the user's single engine install is reused rather
  than duplicated. Duplicate instances break DI and `ServiceKey` lookups. Use a
  pre-1.0 floor like `">=0.7.0 <0.8.0"`, since a future 0.8.0 is breaking under
  the pre-1.0 rule, and re-floor on each engine minor. Mirror the engine versions
  in `devDependencies` with an open floor (`>=0.7.0`) so the current workspace
  and the next engine minor both resolve during development.

## Export split (the one packaging mistake to avoid)

- The **root barrel (`.`) must export only the headless surface.** Re-exporting
  presenters from the root, even as a namespace, puts pixi in the headless import
  path. **Presenters are reachable only via the `./presenters` subpath.**
- `package.json` `exports` declares `"."` and `"./presenters"`, each with
  `import`/`require`/`types` triples. Add one entry per extra subpath the addon
  needs, and give `tsup` one entry file per declared subpath. Dialogue declares
  four: `"."`, `"./presenters"`, `"./yaml"`, and `"./yarn"`, built from
  `src/index.ts`, `src/presenters.ts`, `src/yaml.ts`, and `src/yarn.ts`. See `packages/renderer/package.json`
  for the two-key shape and `packages/addons/dialogue/` for the worked example.
- `@yagejs/renderer` is `optional` in `peerDependenciesMeta`, because only
  `./presenters` needs it. `pixi.js` is **not** a peer at all, since presenters
  reach pixi only through `@yagejs/renderer`.
- Input bindings over `@yagejs/input` (not pixi) may belong with the **root**
  entry when input is part of the addon's required controller. When input is an
  optional adapter over an otherwise input-agnostic model, expose it through an
  `./input` subpath and mark `@yagejs/input` as an optional peer. When a
  controller needs view geometry, such as pointer hit-testing a choice row, it
  must reach the presenter **through an interface**, never by importing the
  presenter module. That keeps the root entry free of pixi.
- **Copy tooling from `packages/particles/`.** `tsconfig.json` extends
  `../../../tsconfig.base.json`; the nested addon path needs the extra `../`.
  `tsup.config.ts` builds ESM and CJS with type declarations, sourcemaps,
  `keepNames`, and an `es2022` target. `vitest.config.ts` keeps the oxc
  legacy-decorator flag for YAGE decorators such as `@trait`. Add
  `@vitest/coverage-v8` as a devDependency.

### Verify the split against the build output, not the source

Source-level grepping is necessary but not sufficient. An `import type` from a
renderer module looks like an import in the source yet is fully erased at build.
A value import buried in a shared chunk can put pixi in the root bundle without
appearing in `src/index.ts`. Verify against the emitted `dist/`:

```bash
# Must all print 0:
grep -c "@yagejs/renderer\|pixi.js" packages/addons/dialogue/dist/index.js
grep -c "@yagejs/renderer\|pixi.js" packages/addons/dialogue/dist/index.cjs
grep -c "@yagejs/renderer\|pixi.js" packages/addons/dialogue/dist/index.d.ts
# Also check every shared chunk the root pulls (tsup names them chunk-*.js):
grep -lc "@yagejs/renderer\|pixi.js" packages/addons/dialogue/dist/chunk-*.js
```

`DialogueController` is the case to watch: it lives in the root entry and
references presenter contracts. Keep those as `import type` only
(`TextPresenter`, `ChromePresenter`, `ChoicePresenter`, `AvatarPresenter`), and
import only pixi-free _values_ such as `InputManagerKey` from `@yagejs/input`.
`input/*` is pixi-free and belongs with the root entry, not with presenters.

### Pixi primitives go through `@yagejs/renderer`

When a presenter needs a pixi display primitive the renderer doesn't expose, add
it to `@yagejs/renderer`, which owns the pixi abstraction. Do not import
`pixi.js` inside the addon. A direct pixi import works, because pixi is a
transitive dependency, but it bypasses the engine's abstraction and adds a second
`pixi.js` peer whose version must be kept in step. `createNineSlice` (plus
`NineSliceOptions` and a re-exported `NineSliceSprite` type) exists in renderer
for this reason, so the addon declares no `pixi.js` peer. Don't pull
`@yagejs/ui` for nine-slice either: `grep -rc "@yagejs/ui" packages/addons/dialogue`
must return 0. The textured variants (`TexturedChrome`, `TexturedBubble`) are
opt-in, reachable only through the `./presenters` barrel plus the optional
`theme.textured` field, and no default bundle or factory references them.

## Controller `input` contract

Every controller that accepts device input declares the same option:
`input?: InputBinding | null`, with three modes:

- **omitted** — the zero-config default. The controller sets up keyboard and
  gamepad action polling plus pointer input, with pointer hit-testing against its
  own bundled presenters. The default path must include working mouse and touch
  input. A presenter without the optional hit-test method keeps working, with the
  pointer side disabled.
- **an `InputBinding`** — replaces the default entirely (custom action names,
  hold thresholds, extra devices).
- **`null`** — no device input. The host calls the controller's public methods
  itself, and the controller constructs no binding: no pointer subscription and
  no action polling.

Reference implementations: `packages/addons/inventory/src/InventoryController.ts`
and `packages/addons/dialogue/src/DialogueController.ts`.

## Package structure

```
packages/addons/<domain>/             # @yagejs-addons/<domain>
  src/
    core/         # headless: model, operations, events, policy types (L1)
    <component>/  # @yagejs/core binding: Component, save integration (L2)
    presenters/   # opt-in: View interfaces + default presenter + themes (L3)
    presets/      # opinionated default configs (mirror particles/src/presets.ts)
    index.ts      # barrel: headless model + component + presets (NO presenters)
    presenters.ts # barrel: everything pixi
  package.json    # exports { ".", "./presenters" }; engine peerDeps; out of fixed group
  tsconfig.json / tsup.config.ts / vitest.config.ts   # copy from packages/particles/
```

## Save / restore for stateful addons

A stateful addon exposes `snapshot()` / `restore()` over its **entire durable
domain state**. The game decides which addon state belongs in a save and adapts
it into its explicit `Serializable<TEncoded>` root. The addon does not register
itself with `@yagejs/save`, traverse the entity graph, or own a save slot.

**Capture the whole cursor, not just the obvious bits.** For dialogue that means
`{ nodeId, stepIndex, vars, chosenOnce, returnStack }`. Omitting `chosenOnce` makes spent
"once" choices available again after a load, with no error. Restoring mid-line
re-presents the current line.

For dialogue, the entire runner cursor is reachable through read-only getters on
`runner.ts`: `getVars()`, `getNodeId()`, `getStepIndex()`, `getChosenOnce()`,
and `getReturnStack()` (pending detours).
A domain snapshot API can therefore capture the cursor without coupling dialogue
to `@yagejs/save`.

## Docs live inside the addon package

An addon's LLM doc source is co-located in the package at
`packages/addons/<name>/docs/llms/<name>.md`, unlike the conceptual docs at the
repo's `docs/llms/`. `docs/scripts/copy-llms.mjs` harvests three source trees
into the generated `docs/public/llms/` tree: `docs/llms/` (conceptual),
`packages/*/docs/llms/` (engine packages, into `public/llms/packages/`), and
`packages/addons/*/docs/llms/` (addons, into `public/llms/addons/`). Never edit
`docs/public/llms/...` directly; edit the co-located source. The human-facing
surface for an addon is `docs/src/content/docs/addons/<name>.mdx`
(Astro/Starlight). Rebuild both surfaces with
`npx turbo run build --filter=@yagejs/docs`.

## `exactOptionalPropertyTypes`

A field assigned a possibly-undefined constructor option is declared
`field: T | undefined`, not `field?: T`. A `?:` declaration rejects the
assignment. Match `PointerInputBinding`'s `unsub` field pattern.

## Lint

`turbo lint` must exit 0 on an addon. YAGE sets
`@typescript-eslint/no-non-null-assertion` at warning level, so it does not fail
the run. Treat only errors as blocking.

## Reference files

- `packages/core/src/types.ts` — `Plugin` contract.
- `packages/particles/` — tooling to copy; `src/presets.ts` (preset pattern).
- `packages/renderer/package.json` — two-key `exports` template.
- `packages/core/src/state/reactive.ts` — `Serializable<TEncoded>`.
- `packages/input/src/InputPlugin.ts`, `packages/audio/src/AudioPlugin.ts` —
  L2b Plugin references.
- `packages/addons/dialogue/` — worked single-system example.
