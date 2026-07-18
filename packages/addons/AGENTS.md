# YAGE Addons — Authoring Guide

Audience: **agents building addons** (not consumers). Read this before adding or
changing anything under `packages/addons/`.

## What an addon is

An **addon** is an *installable, opinionated implementation of one cohesive
gameplay pattern*, designed so its opinions are overridable without forking. One
addon = one thing a developer reaches for by name (dialogue, inventory, combat,
player-controllers, prototype kit).

It is **not** a generic data-structure library, a batteries-welded-shut system,
or a mainline plugin. Addons are *gameplay patterns*; mainline plugins (`core`,
`renderer`, `physics`, …) are *engine infrastructure* — many games ship zero
dialogue/inventory. The distinction from mainline is **editorial, not
engineering**. If you'd describe it as "a game like X" (an RPG), that's a
**template** (a `create-yage` starter), not an addon.

## The two failure modes

| Failure | Symptom | Root cause |
|---|---|---|
| **Too generic** | User writes as much config as building it themselves; "it's just a `Map` with events" | The addon owns *abstraction* instead of the fiddly *concrete logic* |
| **Cornered** | Works until the user's game differs, then they fork/abandon | The addon baked *domain decisions* into its *plumbing* |

The fix is not a perfect mid-level abstraction. It is **separating layers so each
is opinionated at its own level and replaceable independently**, plus the seven
rules below that keep each layer honest.

## The layer model (L0–L3)

An addon uses **only the layers its pattern needs**.

- **L0 Assets** — bundled files (art, fonts, themes). Optional; needs
  `"files": ["dist", "assets"]`. Prefer zero bundled assets where possible
  (e.g. dialogue's default theme is Graphics + canvas fonts).
- **L1 Model** — headless logic + operations + events. No engine deps, or
  `@yagejs/core`-only. Fully unit-testable. **Enforce headlessness as an
  invariant** ("no `@yagejs/renderer`/`pixi` import in the model layer, ever").
- **L2 Engine integration — two co-equal forms (use either or both):**
  - **L2a Component** — per-entity behavior; hosts the model, bridges model
    events → entity events, integrates save. `@yagejs/core` only. Zero setup:
    user `entity.add()`s it; `ComponentUpdateSystem` drives it.
  - **L2b Plugin (+ System + Service)** — cross-cutting orchestration: a System
    for cross-entity per-frame work, a `ServiceKey` Service for global shared
    state, scene hooks, DOM/gamepad/loop wiring. User must `engine.use(...)`.
    Config/presets flow through the **plugin constructor** (like
    `InputPlugin`/`AudioPlugin`).
- **L3 View** — presentation behind an interface, with a default presenter,
  reachable only via a `/presenters` subpath so the headless path never pulls
  pixi. For views with multiple independently-varying parts, **split the
  interface into *capability channels* rather than one coarse presenter**
  (see the channels pattern below). One coarse presenter is fine only when the
  view is one indivisible thing.

### Decision rule — L2a vs L2b

Follows the codebase rule ("Components own game logic; Systems for engine
internals"): one-entity state → **Component (L2a)**; global / cross-entity /
loop / external-IO → **Plugin+System (L2b)**. Many patterns need **both**
(combat: `Hitbox` components + an overlap System). Component-only = zero-config;
a Plugin costs the user an `engine.use()` line.

### Refinement — host-owned cross-cutting

"This pattern touches pause/focus/global state, therefore it needs L2b" is **not
automatic**. When *which instance is active* or *whether the world pauses* is
genuinely **game policy** — especially when multiple instances can run at once —
owning it in a global Service is wrong. **Dialogue is the worked
counter-example:** it ships as an L2a `Component` the game spawns, exposes
`isActive()`, and lets the host decide focus and pause (several ambient
conversations can run concurrently, no global singleton). Prefer host-owned
cross-cutting when the pattern is naturally multi-instance or the policy is the
game's to set.

## Capability-channels presentation pattern

When the view has several independently-varying parts, split L3 into narrow
**capability channels** instead of one fat presenter interface. Dialogue splits
into `TextChannel` / `ChoiceChannel` / `AvatarChannel` / `ChromeChannel`, so the
typewriter, choice UI, portrait, and frame are each swappable and composable. A
**composite presenter** fans one event stream out to several channels. This is
what makes "logic installed, presentation swappable, copy-paste/eject for UI
only" actually hold.

## Rules in, consequences out

- **Rules** the system needs to function correctly (do these stack? can this go
  here? is this choice available?) are **injected as policy** (config values +
  pure functions).
- **Consequences** in the game (what a potion does, a pickup SFX, what a custom
  command means) are **emitted as events**.
- When the mechanical-vs-game line is genuinely blurry, model the process as an
  **ordered pipeline of injectable steps**, each defaulting to sensible
  behavior, each replaceable, with **events at the boundaries**. (Dialogue:
  the `set` flow op is owned by the runner; every other command surfaces via an
  `onCommand` handler **and** an event, with optional `blocking`/async handling
  for cinematic sequencing.)

## The seven rules

1. **Ship a concrete default, not a framework.** The primary export is an
   opinionated *working* implementation. The 5-minute path must run.
2. **Opinions are *data and functions*, not *structure*.** Express opinionated
   bits as config values + injected pure policy functions, never hardwired
   branches or subclass-only behavior. The user overrides the *policy*, not the
   *plumbing*.
3. **The domain type is the user's, not yours — for data/state addons.** Be
   generic over the game's type (`Inventory<TItem>`), requiring only a tiny
   accessor/policy. Behavior addons (controllers, bullet-time) have no domain
   type — they lean on config + policy hooks + events. Don't force a `<T>` where
   none belongs.
4. **Layers, each independently usable** (L0–L3 above). An addon uses only the
   layers its pattern needs.
5. **Rules in, consequences out — and when blurry, a pipeline of steps** (above).
6. **Escape hatches at every layer.** Underlying state is readable; documented
   direct-mutation methods exist; the model is swappable inside the component.
   Never let the *only* API be a convenience that hides state.
7. **The "would you write this yourself?" test (scoping).** Own the
   annoying-but-non-trivial logic (stack merge/split, slot swap, hitbox overlap,
   save round-trip, typewriter + branching). Expose a hook for anything trivial
   or game-specific (item balance, what a custom command does). This decides the
   surface area and dodges both failure modes.

## Theme authoring

A theme is a plain data object (no behavior), serializable, authored inline or spread-and-tweaked. The rule for what belongs in it is **data vs code**:

- **Theme field (data):** any pure value a built-in renderer consumes — a color, size, gap, radius, alpha, texture key, or nine-slice insets. Declare it as an optional-derived field (`field?`) that falls back to a sensible default when omitted, and name the default in the JSDoc (`Omit to derive X`). Keep the interface flat with surface-grouped ordering and section comments. Nested objects require a deep-partial resolver to spread-and-tweak, which callers don't have.
- **Render-delegate preset (code):** any new drawing code. Mirror the `CellPresenter`/`CellHandle` shape — the view computes rects, placement, and hit-tests; the preset only draws. Custom presets carry their own config by closure. They should still read the shared palette, font, and layer tokens so a single theme change keeps all surfaces consistent. Never add preset-specific tokens to the shared theme.
- **View (behavior):** placement, windowing, navigation, hit-tests. These stay hardcoded in the view. To change them, replace the entire view. ±1px alignment nudges, shape-geometry constants, and contrast floors are also view-internal — they have no meaning outside the specific view that uses them.

**Drift-guard:** every addon with a theme factory must have a test that walks the fully-populated theme to the presenter configs and fails if any field is unthreaded. See `packages/addons/inventory/src/factory/theme.test.ts` for the sentinel-walk pattern.

## Design archetypes (guidance, NOT encoded in the name)

- **Collection** — many interchangeable pieces/variants/assets (prototype,
  player-controllers). Usually L0/L2a/L3, light on L1.
- **Single system** — one cohesive installed system (dialogue, combat). Usually
  L1 + L2a-or-L2b (+ L3). *Dialogue's shape:* L1 headless core + **L2a
  Component** (host owns focus/pause) + **L3 capability channels** + **save via
  a `SnapshotContributor`**.
- **Pure library** — headless logic only (stats-formula). L1 only.

Single *tiny* mechanics (e.g. bullet-time) are usually **recipes/examples** (a
copyable snippet), not packages — promote to a package only on demonstrated
reuse, to avoid sprawl.

## Naming & packaging mechanics

- **Scope:** `@yagejs-addons` (own npm org, separate from engine `@yagejs`).
  Domain-only package names, **no tier suffixes** — the scope is the only
  category marker. `@yagejs-addons/dialogue`, `/inventory`, `/combat`.
- **Export-symbol naming (cross-addon).** Value exports a consumer types into game
  code — bundle factories, action-map presets, default themes — are
  **domain-prefixed** so two addons never collide on an auto-import:
  `dialogueControls`/`inventoryControls`, `DEFAULT_DIALOGUE_ACTIONS`,
  `defaultInventoryTheme`. Interface and class contracts (`InputBinding`,
  `KeyboardInputBinding`, `ChromePresenter`) may stay generic — a wrong import is a
  compile error, not a silent hazard, and identical shapes are harmless. Event
  tokens are always domain-prefixed (`DialogueFooEvent`, `InventoryFooEvent`). This
  is why virtual-controls (`defaultControlsTheme`, `VIRTUAL_CONTROLS_LAYERS`) has
  zero collisions where dialogue's original generic names did not.
- **Granularity:** one package per addon, each with its own curated dependency
  closure. (A single `@yagejs/addons` package with subpath exports was rejected:
  subpath exports split *code*, not *dependencies* or *versions*.)
- **Repo location:** `packages/addons/<domain>/` inside this Turborepo. The npm
  workspaces glob `packages/addons/*` (added to the root `package.json`) picks
  them up — note `packages/*` is single-level and does **not** match the nested
  path.
- **Versioning:** addons are **independent** — keep them **out of the engine's
  `fixed` group** in `.changeset/config.json` so they iterate without forcing
  core bumps and vice-versa. Do not add an addon's name to that array. Use
  `minor` for initial/feature 0.x releases (pre-1.0 rule; never propose 1.0.0).
- **Engine deps as `peerDependencies`** (optional via `peerDependenciesMeta`
  where presentation-only), so the user's single engine install is reused, never
  duplicated — this avoids duplicate-instance DI/`ServiceKey` hazards. Use a
  pre-1.0 floor like `">=0.7.0 <0.8.0"` (a future 0.8.0 is breaking per the
  pre-1.0 rule); re-floor on each engine minor. Mirror the engine versions in
  `devDependencies` (`^0.7.0`) so it builds/tests in-workspace.

## Export split (the one packaging mistake to avoid)

- The **root barrel (`.`) must export only the headless surface.** Re-exporting
  presenters from the root — even as a namespace — pulls pixi into the headless
  import path. **Presenters are reachable only via the `./presenters` subpath.**
- `package.json` `exports` declares both `"."` and `"./presenters"` with
  `import`/`require`/`types` triples; `tsup` has two entries (`src/index.ts`,
  `src/presenters.ts`). See `packages/renderer/package.json` for the two-key
  shape and `packages/addons/dialogue/` for the worked example.
- Input bindings over `@yagejs/input` (not pixi) belong with the **root** entry
  alongside the controller. When the controller needs view geometry (e.g.
  pointer hit-testing a choice row), it must reach the presenter **through an
  interface seam**, never by importing the presenter module — that preserves the
  no-pixi guarantee on root.
- **Copy tooling from `packages/particles/`**: `tsconfig.json` (extends
  `../../../tsconfig.base.json` — note the extra `../` for the nested addon
  path), `tsup.config.ts`, `vitest.config.ts` (keep the oxc legacy-decorator
  flag for future `@serializable`; add `@vitest/coverage-v8` as a devDep).

## Controller `input` contract

Every controller that accepts device input declares the same option:
`input?: InputBinding | null`, with three modes:

- **omitted** — the zero-config default: full device wiring (keyboard/gamepad
  action polling PLUS pointer), with pointer hit-testing wired to the
  controller's **own bundled presenters**. The 5-minute path must include
  working mouse/touch; a presenter without the optional hit-test method
  degrades the pointer side gracefully.
- **an `InputBinding`** — replaces the default entirely (custom action names,
  hold thresholds, extra devices).
- **`null`** — NO device input: the embedded/host-driven mode; the host calls
  the controller's public methods itself, and the controller constructs no
  binding (no pointer subscription, no action polling).

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

## Save / restore for stateful addons → `SnapshotContributor`

A stateful single-system addon owns runtime state that lives **outside** the
entity/component graph (a runner cursor, branching vars, "once" flags). Round-trip
it through a `SnapshotContributor` (`packages/save/src/snapshot/types.ts`): the
headless model exposes `snapshot()` / `restore()` over its **entire** state, and
the L2 layer registers a contributor so the game's save system persists it
without knowing internals.

**Capture the whole cursor, not just the obvious bits.** For dialogue that means
`{ nodeId, stepIndex, vars, chosenOnce }` — omitting `chosenOnce` silently
resurrects spent "once"-choices after a load. Restoring mid-line re-presents the
current line.

For the dialogue addon this is **deferred to v1.1**: do not build snapshot/restore
now, but keep the runner cursor reachable through read-only getters (`getVars`
exists; `getNodeId`/`getStepIndex`/`getChosenOnce`) so the contributor is purely
additive later — no breaking change. `@yagejs/save` is **not** a dependency now.

## Reference files

- `packages/core/src/types.ts` — `Plugin` contract.
- `packages/particles/` — tooling to copy; `src/presets.ts` (preset pattern).
- `packages/renderer/package.json` — two-key `exports` template.
- `packages/save/src/snapshot/types.ts` — `SnapshotContributor`.
- `packages/input/src/InputPlugin.ts`, `packages/audio/src/AudioPlugin.ts` —
  L2b Plugin references.
- `packages/addons/dialogue/` — the first addon; worked single-system example.

## New learnings from the dialogue port (first addon)

These were discovered while porting `@yagejs-addons/dialogue`. They generalize to any addon with a headless/pixi split.

### Pixi-free root entry: verify at the build artifact, not just the source

The locked rule is that the root entry (`.`) must NOT transitively import `pixi.js` or `@yagejs/renderer`; all pixi lives behind `./presenters`. Source-level grepping is necessary but NOT sufficient — `import type` from a renderer module looks like an import in source yet is fully erased at build, and a value import buried in a shared chunk can sneak pixi into the root bundle without appearing in `src/index.ts`. Verify against the emitted `dist/`:

```bash
# Must all print 0:
grep -c "@yagejs/renderer\|pixi.js" packages/addons/dialogue/dist/index.js
grep -c "@yagejs/renderer\|pixi.js" packages/addons/dialogue/dist/index.cjs
grep -c "@yagejs/renderer\|pixi.js" packages/addons/dialogue/dist/index.d.ts
# Also check every shared chunk the root pulls (tsup names them chunk-*.js):
grep -lc "@yagejs/renderer\|pixi.js" packages/addons/dialogue/dist/chunk-*.js
```

`DialogueController` is the trap: it lives in the root entry but references presenter contracts. Keep those as `import type` only (TextPresenter/ChromePresenter/ChoicePresenter/AvatarPresenter), and import only pixi-free *values* (e.g. `InputManagerKey` from `@yagejs/input`). `input/*` is pixi-free and intentionally belongs with the root entry, not presenters.

### Canvas-default vs bitmap-opt-in font split

Default presenters use Graphics chrome + canvas `SplitTextComponent`/`TextComponent` with ZERO bundled assets. `defaultTheme()` sets no `bitmapFont*`/`textured`/portrait fields — only a `fontFamily` plus Graphics colors/layers. The view selects the path by presence: `font = bitmapFont ?? fontFamily`, and only flips to the bitmap path when `bitmapFont` is set. Native bold/italic + per-glyph tint effects come for free on the canvas path. Bitmap fonts (variant atlases) are an explicit opt-in theme path, never the default.

Renderer API name drift to watch: the brief named `bakeBitmapFont` / `BitmapFontVariantTextures`, but `@yagejs/renderer`'s barrel actually exports `bitmapFont` / `installBitmapFont` / `BitmapFontVariant` (+ `resolveTextureInput` / `TextureInput`). The addon never imports a bitmap symbol by value (it only passes font-name strings), so this didn't bite the build — but use the real symbol names when extending the opt-in bitmap theme path.

### Nine-slice without a `@yagejs/ui` dependency

Texture-driven re-theming (`TexturedChrome` / `TexturedBubble`) uses `@yagejs/renderer`'s `createNineSlice` primitive — **not** a direct `pixi.js` import. **Lesson (general):** when a presenter needs a pixi display primitive the renderer doesn't expose, ADD it to `@yagejs/renderer` (it owns the pixi abstraction) rather than importing `pixi.js` inside the addon. Reaching past renderer to pixi works mechanically (pixi is a transitive dep) but bypasses the engine's abstraction and saddles the addon with a second `pixi.js` peer + version surface to keep in lockstep. `createNineSlice` (+ `NineSliceOptions`, and a re-exported `NineSliceSprite` type) was added to renderer for exactly this — so the addon declares **no** `pixi.js` peer at all. Do NOT pull `@yagejs/ui` for nine-slice either — verify `grep -rc "@yagejs/ui" packages/addons/dialogue` returns 0. These textured variants are opt-in: reachable only via the `./presenters` barrel + the optional `theme.textured` field; no default bundle or factory references them.

### v1.1 save seam (kept reachable without building snapshot/restore)

Save/load is deferred to v1.1 — do NOT build snapshot/restore. But keep the runner cursor reachable so a `SnapshotContributor` (type at `packages/save/src/snapshot/types.ts`) can be added later WITHOUT a breaking change. `runner.ts` exposes read-only `getVars()`, `getNodeId()`, `getStepIndex()`, `getChosenOnce()` under a commented "v1.1 save seam" block. This is documented in code comments and the authoring doc.

### Glossary terms were CUT from the first release (2026-06-11)

The `[term=id]`/`[gloss=id]` markup, the text-view hit-testing/underline machinery, the `TermTarget`/`setTermSink` binding seam, and `DialogueTermActivatedEvent` were removed before first publish — the feature crossed all three layers (presenter -> input -> controller) and generated a disproportionate share of review findings for a phase-1 addon. Unknown tags drop silently, so scripts containing `[term]` still parse. If re-introduced, design it post-Design-C with the theming/extensibility story, mirroring `PointerChoiceTarget` the way the original did (see git history on `feat/dialogue-addon`).

exactOptionalPropertyTypes gotcha (still applies generally): fields assigned possibly-undefined ctor options are declared `field: T | undefined` (NOT `field?: T`) — `?:` would reject the assignment. Match `PointerInputBinding`'s `unsub` field pattern.

### Independent versioning + changeset

The addon is EXCLUDED from `.changeset/config.json`'s `fixed` group (the `@yagejs/*` + `create-yage` cohort), so it versions independently. Confirm with `grep -c "yagejs-addons" .changeset/config.json` == 0. The new-package changeset is a plain `minor` for `@yagejs-addons/dialogue` only — the fixed group's cascade handles dependents; never add the addon to that array as a shortcut.

### Package config: copy particles' shape

`tsconfig.json` extends `../../../tsconfig.base.json` (note the extra `..` — addons are one level deeper at `packages/addons/<name>`). `tsup` builds two entries (`src/index.ts`, `src/presenters.ts`), ESM+CJS, dts, sourcemap, `keepNames`, es2022. `package.json` declares both `.` and `./presenters` exports with import/require + types. `@yagejs/renderer` is `optional` in `peerDependenciesMeta` (only `./presenters` needs it); `pixi.js` is **not** a peer — presenters reach pixi only through `@yagejs/renderer`. Engine peers are mirrored in `devDependencies` so local builds resolve them. The root `package.json` `workspaces` already globs `packages/addons/*` — no workspace edit needed.

### Docs co-locate + sync (addons differ from engine packages)

Unlike the conceptual docs at the repo's `docs/llms/`, an addon's LLM doc source is **co-located inside the package** at `packages/addons/<name>/docs/llms/<name>.md`. `docs/scripts/copy-llms.mjs` harvests three source trees — `docs/llms/` (conceptual), `packages/*/docs/llms/` (engine packages → `public/llms/packages/`), and `packages/addons/*/docs/llms/` (addons → `public/llms/addons/`) — into the GENERATED `docs/public/llms/` tree. Never edit `docs/public/llms/...` directly; edit the co-located source. The human/narrative surface for an addon is `docs/src/content/docs/addons/<name>.mdx` (Astro/Starlight). Rebuild both surfaces with `npx turbo run build --filter=@yagejs/docs`.

### Lint baseline

`turbo lint` on the addon is GREEN (exit 0) with 0 errors and ~46 `@typescript-eslint/no-non-null-assertion` WARNINGS (in `input/InputBinding.ts` and `render/DialogueTextView.ts`), consistent with the ported code's existing style and YAGE's warning-level convention. Warnings don't fail the loop; only treat errors as blocking.
