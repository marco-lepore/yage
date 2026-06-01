# @yagejs-addons/dialogue

The first **YAGE addon** — an installable, opinionated dialogue system: a
headless branching runner plus swappable, themeable presenters. Drop it into a
scene, point it at a dialogue script, and get a working typewriter box (or
speech bubble) with branching choices, inline markup, and glossary-term
highlighting — then re-theme or replace any piece without forking.

Addons are the layer between engine plugins (`@yagejs/core`, `@yagejs/renderer`,
…) and your game: real implementations of common gameplay patterns, opinionated
enough to be worth installing, layered so the opinions stay overridable. See
`packages/addons/AGENTS.md` for the authoring model.

## Install

```bash
npm install @yagejs-addons/dialogue
```

The addon declares the engine packages as **peer dependencies**, so it reuses
your single engine install rather than duplicating it. Install the engine
yourself:

```bash
npm install @yagejs/core @yagejs/input @yagejs/renderer
```

- `@yagejs/core` and `@yagejs/input` are **required** peers — the headless
  runner and the `DialogueController` use them.
- `@yagejs/renderer` is the **optional** peer — only the `./presenters` subpath
  needs it (and it brings `pixi.js` transitively, so you never install pixi
  yourself). If you consume only the headless runner you can skip it.

## Two entry points

The package is split so the headless path never pulls a renderer:

```ts
// Headless + input only — no pixi, fully unit-testable.
import { DialogueRunner, DialogueController } from "@yagejs-addons/dialogue";

// Pixi presentation — Graphics chrome + canvas text, themes, factories.
import { defaultTheme, createBoxDialogue } from "@yagejs-addons/dialogue/presenters";
```

| Entry          | Imports                          | Contains                                                                 |
| -------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `.`            | `@yagejs/core`, `@yagejs/input`  | runner, session, types, markup, i18n, canonical format, events, `DialogueController`, input bindings |
| `./presenters` | + `@yagejs/renderer` (brings pixi)  | chrome, text views, composites, avatars, factories, `defaultTheme()`, textured nine-slice variants, radial (experimental) |

## Defaults & opt-ins

- **Default presenters are zero-asset**: Graphics objects for chrome plus canvas
  `SplitText`/`Text` for the typewriter, with native bold/italic and per-glyph
  effects. `defaultTheme()` gives you a working look with no bundled files.
- **Bitmap fonts** (baked variant atlases via `bakeBitmapFont`) are an **opt-in**
  theme path, not the default.
- **Textured chrome/bubble** (nine-slice from your own textures) is an **opt-in**
  variant; pass texture fields on the theme.
- **Radial choice presenter** is exported under `./presenters` as
  **`@experimental`** — not polished, opt-in only.
- **Glossary terms** (`[term]…[gloss]` markup) are highlighted and hit-tested;
  pointer hover/tap routes to an `onTermActivate(id)` callback. The game owns the
  tooltip UI — the addon only emits the term id (plus an optional screen
  position).

## Save / load

Snapshot/restore is **deferred to v1.1**. The runner keeps its cursor reachable
through read-only getters so a `SnapshotContributor` (`@yagejs/save`) can be
added later without a breaking change.

## Publishing caveat (`@yagejs-addons` scope)

Addons live under the **`@yagejs-addons` npm scope** — a separate org from the
engine's `@yagejs` scope. The scope is the only category marker (no
`-toolkit`/`-system` suffixes). Addons are **independently versioned**: they are
deliberately kept out of the engine's `fixed` changeset group, so engine
releases never force an addon bump and vice-versa. Publishing requires
membership in the `@yagejs-addons` org and `publishConfig.access: "public"`
(already set here).
