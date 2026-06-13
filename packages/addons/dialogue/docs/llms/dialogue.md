# @yagejs-addons/dialogue

Dialogue runner, branching, and swappable presenters for YAGE — the first YAGE
addon (`@yagejs-addons` scope, independently versioned, NOT in the engine `fixed`
group). Headless branching core + a `@yagejs/core` Component + pixi presenters.

## Install

```bash
npm install @yagejs-addons/dialogue
# engine peers (single install, reused — not bundled):
npm install @yagejs/core @yagejs/input @yagejs/renderer
```

`@yagejs/core` + `@yagejs/input` are required peers; `@yagejs/renderer` + `pixi.js`
are optional peers (only the `./presenters` subpath needs them).

## Two entry points (export split — load-bearing)

- **`.`** (root) — headless + non-pixi. Runner, session, types, markup, i18n,
  canonical format, events, `DialogueController` (a `@yagejs/core` Component),
  `@yagejs/input` bindings. **MUST NOT transitively import pixi / renderer.**
- **`./presenters`** — everything pixi. Chrome, text views, composites, avatars,
  factories, `defaultTheme()`, textured nine-slice variants, experimental radial.

```ts
import { DialogueController, DialogueRunner } from "@yagejs-addons/dialogue";
import { defaultTheme, createBoxDialogue } from "@yagejs-addons/dialogue/presenters";
```

## 5-minute setup (zero assets)

`defaultTheme()` = Graphics chrome + canvas SplitText/Text, native bold/italic,
per-glyph effects. No bundled files. The scene must declare the dialogue layers.

```ts
import { Scene, Entity } from "@yagejs/core";
import { DialogueController, DialogueEndedEvent } from "@yagejs-addons/dialogue";
import { createBoxDialogue, DIALOGUE_LAYERS } from "@yagejs-addons/dialogue/presenters";

class TalkScene extends Scene {
  readonly layers = [...DIALOGUE_LAYERS]; // dialogue-frame / -avatar / -text (screen-space)

  onEnter() {
    const host = this.spawn("dialogue") as Entity;
    const dlg = host.add(new DialogueController({ ...createBoxDialogue() }));
    host.on(DialogueEndedEvent, () => host.destroy());
    dlg.play(script);
  }
}
```

`createBoxDialogue(theme?)` — bottom-of-screen box; theme defaults to
`defaultTheme()`. `createBubbleDialogue(theme?, { worldLayer })` — diegetic
speech bubble following a `DialogueActor`. `createMixedDialogue(theme?, opts)` —
routes each line/choice to box or bubble by its `view` hint.

## Script model — TS-first via `defineScript` (JSON-able)

`defineScript(...)` is an identity helper that captures the script's var/external
types so `play()` requires a matching binding and returns a typed handle. A plain
`DialogueScript` literal still works and gets the SAME runtime validation — the
brand is compile-time only.

```ts
const script = defineScript({
  id: "intro",
  start: "n1",
  vars: { rude: false },                 // dialogue vars: conversation-local, mutable
  external: { gold: "number" },          // externals: game state, READ-ONLY to the script
  speakers: { gwen: { id: "gwen", name: "Gwen", color: 0xffd866 } },
  nodes: {
    n1: { id: "n1", steps: [
      { kind: "say", speaker: "gwen", text: "You carry {gold} gold, [b]traveler[/b]." },
      { kind: "choice", text: "Well?", options: [
        { text: "Hi.", target: "n2" },
        { text: "Leave.", once: true, commands: [{ type: "set", var: "rude", value: true }] },
      ] },
    ] },
    n2: { id: "n2", steps: [{ kind: "say", text: "Safe travels." }, { kind: "end" }] },
  },
});
```

Step kinds: `say` | `choice` | `command` | `goto` | `end`.
- `SayStep`: `text` (+ optional i18n `key`), `speaker?`, `expression?`, `speed?`,
  `autoAdvanceMs?`, `commands?`, `view?`, `meta?`, `voice?`.
- `ChoiceOption`: `text`, `target?`, `condition?`, `once?`, `commands?`, `meta?`.
- `CommandStep`: `commands` (+ optional `condition`/`target` conditional jump).
- `Condition`: a var/external key (truthy), `{ var, op, value }` (op =
  `== != > >= < <= truthy falsy`), or `(vars) => boolean` (TS-only, not JSON;
  receives the merged vars+externals view).

### vars vs external (one lookup namespace, two ownership classes)

- **`vars`** — conversation-lifetime branching state. Each entry is its own
  declaration + default + (by `typeof`) type. Reset fresh on every `play()` (so
  a stale value can't leak between plays), written by `set` / `ctx.setVar` /
  `handle.setVar`.
- **`external`** — game-lifetime state the script only READS, declared `name →
  "string"|"number"|"boolean"`. The host supplies each at `play()` as a constant
  or a live getter. Scripts mutate game state via **commands**, never `set`
  (rules-in / consequences-out, enforced structurally).

Conditions, `{token}` interpolation, and choice gates all read the merged view.
A `{gold}` token resolves **at line-present time** (an earlier command's effect
shows on a later line); already-shown lines never re-render, and a choice menu's
conditions don't live-refresh while open.

### Validation (two hard-error stages)
- **Load-time** (`loadScript` / `defineScript` path, binding-free): every
  condition `var`, `set` target, and default-locale `{token}` must resolve to a
  declared `vars`/`external`; `set` targets must be ∈ `vars`; numeric ops on a
  non-number declared operand error. Throws `DialogueScriptError`. (Tokens inside
  *translated* strings are checked against default-locale text only.)
- **Play-time** (`validateBinding`): the binding must cover every declared
  external with `typeof`-correct values/getter results, and resolve every command
  `type` to a handler/fallback. Throws `DialogueBindingError`.

## Inline markup (`parseMarkup` / `stripMarkup`)

BBCode-ish, survives translation, nests, unknown tags dropped silently:
`[b]` `[i]` `[color=#ffcc00]`/`[color=gold]` `[wave]` `[shake]` `[pulse]`
`[rainbow]` `[speed=2]` `[pause=400]` (zero-width ms). `\[` escapes a literal
bracket. (NOTE: ruby/furigana and glossary `[term]`/`[gloss]` markup were
intentionally removed — unknown tags drop silently, so old scripts still parse.)

All character counts are **graphemes** (user-perceived characters, via
`Intl.Segmenter` — the same segmentation pixi's SplitText renders one glyph
per): `ParsedText.length`, `TextRun.graphemeCount`, `PauseToken.atChar`, and
the reveal rate (`charsPerSec` = graphemes/second). An emoji, ZWJ sequence, or
base+combining-mark cluster counts as 1. `splitGraphemes(str)` is exported.

## Binding — game state in, the typed handle out

`play(script, binding)` is the single bridge (replaces the old `params` +
`onCommand`). The binding (required when the script declares externals):

```ts
const handle = controller.play(script, {
  state: { gold: () => player.gold,   // external getter — live read
           rude: false },             // optional override of a var default (by value)
  commands: {                          // command type → handler (game logic)
    "give-item": (cmd, ctx) => { player.give(cmd.id); },
    "skill-check": async (cmd, ctx) => { ctx.setVar("passed", await roll(cmd.stat)); },
  },
  fallbackCommand: (cmd) => log(cmd),  // optional, catches dynamically-typed commands
});
handle.setVar("rude", true);           // live poke (typed keyof vars); no-ops after stop/replay
handle.getVars();                      // snapshot of dialogue vars (externals excluded)
```

- **Getters must be cheap + side-effect-free** — called on every condition test
  and present.
- **`ctx.setVar(key, value)`** writes a dialogue var only (the skill-check seam:
  a result that matters to THIS conversation, not game state). Throws on an
  external/unknown name. Keyed `keyof vars` on the typed path.
- Controller-level defaults: `new DialogueController({ binding })` merge under
  the per-`play()` binding (call-site wins key-by-key).

### Commands — rules in, consequences out

Runner owns built-in `set` (writes a dialogue `var`, guarded). Every other
command dispatches to `binding.commands[type]` (or `fallbackCommand`) **and**
fires `DialogueCommandEvent` (observation). `ctx.mode` is `"play" | "skip"`. A
`say` line's commands fire by timing `at: "show" | "afterReveal" | "advance"`
(default `show`). `blocking: true` + an async handler pauses the conversation
until it resolves (cinematic sequencing). `{ type: "expression", value }` is the
avatar built-in (no handler needed). Every non-built-in command `type` a script
uses must resolve to a handler/fallback, else play-time error.

## DialogueController (L2a Component) — host owns focus/pause

```ts
new DialogueController({
  ...createBoxDialogue(theme),    // DialogueBundle: { chrome, text, choices, avatar?, skipMultiplier? }
  avatar,                          // optional AvatarPresenter override
  i18n,                            // optional I18nAdapter
  binding: { state, commands },    // optional controller-level binding defaults (see Binding)
  input,                           // optional InputBinding (default: KeyboardInputBinding)
  onEnded: () => {},
});
```

Methods: `play(script, binding?): DialogueHandle | undefined` (undefined if the
component was removed), `isActive()`, `stop()`, `skip()`,
`setAutoAdvance(ms | null)`, `preview(nodeId): PreviewedLine[]`. It is
multi-instance friendly — several ambient conversations can run at once; "which
is interactive" and "does the world pause" are the game's policy (no global
singleton).

Events (entity → scene bubbling): `DialogueStartedEvent`, `DialogueLineEvent`
(`{ speaker?, text }` plain text), `DialogueChoiceShownEvent`,
`DialogueChoiceMadeEvent`, `DialogueCommandEvent` (`{ command, mode }`),
`DialogueEndedEvent`.

## Channels + presenters (L3 capability channels)

Headless channels (core): `TextChannel`, `ChoiceChannel`, `AvatarChannel`,
`ChromeChannel`. Presenter adapters add the YAGE lifecycle (`mount`/`dispose`)
and pointer seams: `TextPresenter`, `ChromePresenter`, `ChoicePresenter`.
Defaults: `DialogueChrome`, `ChoiceListPresenter`, `DialogueTextView` (box);
`BubbleChrome`, `BubbleChoicePresenter`, `BubbleTextView` (world; the bubble sizes
to its text — grows width to `maxWidth`, then wraps + grows height — via the
renderer's `measureWrappedText`). Composites
(`CompositeChrome`/`CompositeTextPresenter`/`CompositeChoicePresenter`) route by
`view`. Avatars: `PortraitPresenter`, `SceneFigurePresenter`,
`NullAvatarPresenter`; `DialogueActor` (component on a world entity, self-registers
by speaker id) + `actorRegistryFor(scene)`.

`DialogueTextView` renders one `SplitTextComponent` per line, reveals glyphs by
toggling `chars[i].visible`, and applies per-run colour/bold/italic and per-glyph
effects.

## Input (root entry, `@yagejs/input` — not pixi)

`KeyboardInputBinding(actions?, skipHoldMs?)` (default),
`PointerInputBinding(choiceTarget?)`, `CompositeInputBinding`,
`fullControls(choiceTarget?, { actions?, skipHoldMs? })`. Actions:
`DEFAULT_ACTIONS` (advance/speed/up/down), `FULL_ACTIONS` (+ skip). `skipHoldMs > 0`
is the classic hold-to-confirm skip (default `0` = fire on press); fast-forward is
the `speed` action held. `PointerChoiceTarget` lets a pointer binding hit-test
choice rows without owning geometry. Ambient/auto-advancing dialogue attaches no
binding.

## Theming

`DialogueTheme` is one flat data object: `box`, `padding`, frame colours,
`nameColor/Size`, `textSize/lineHeight/textColor/charsPerSec`, choice colours,
fonts (`bitmapFont/fontFamily/resolution` — the shared `FontConfig` triplet every
presenter config extends), `layerFrame/layerText`, `skipMultiplier?`.
`defaultTheme()` returns a fresh zero-asset instance — spread to tweak:
`{ ...defaultTheme(), textColor: 0xff0000 }`. Known limitation: the `textured?`
theme field exists but is NOT consumed by anything yet (a nine-slice chrome
branch is planned; until it lands the Graphics chrome is the only frame).

- **Default**: Graphics chrome + canvas text (`fontFamily`). Zero assets.
- **Bitmap fonts** (opt-in): set `bitmapFont` (baked via `installBitmapFont`)
  for a crisp pixel atlas. Bold/italic are synthesised on the regular atlas
  (skew + double-draw); there are no variant-atlas fields.

## Experimental radial choice presenter

`RadialChoicePresenter` (+ `RadialChoiceConfig`) is exported from `./presenters`
as **`@experimental`**. A Mass-Effect-style wheel; not in any default factory
bundle, unpolished, geometry/API may change. Opt-in only.

## Save / load — DEFERRED to v1.1

Mid-dialogue *cursor* save/restore is NOT supported yet: no snapshot/restore
exists, `@yagejs/save` is NOT a dependency, and the runner's positional getters
(`getNodeId()`, `getStepIndex()`, `getChosenOnce()`) are NOT reachable through
`DialogueController`/`DialogueSession` — do not try to capture a conversation
cursor. (`handle.getVars()` IS reachable, but it's the dialogue-var snapshot, not
a resumable cursor.) The binding model makes the future API purely additive
(`handle.getCursor()` = mutable var map + `{ nodeId, stepIndex, chosenOnce }`;
externals are excluded by construction — the game's own save owns them). Save
outside conversations (or replay the script) until v1.1 adds the seam.
