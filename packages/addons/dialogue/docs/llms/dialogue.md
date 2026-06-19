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

`defineScript(...)` is an identity helper that captures the script's declared
variable types so `play()` returns a typed handle. A plain `DialogueScript`
literal still works and gets the SAME runtime validation — the brand is
compile-time only.

```ts
const script = defineScript({
  id: "intro",
  start: "n1",
  declare: { rude: false, timesTalked: 0 },   // variable defaults (seed-if-absent)
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
- `Condition`: a variable name (truthy), the atomic `{ var, op, value }` (op =
  `== != > >= < <= truthy falsy`), an `Expr` tree (see below), or `(vars) =>
  boolean` (TS-only, not JSON; receives a materialized snapshot).

### Variables, storage, and seed-if-absent

ONE opaque name namespace lives in a **`VariableStorage`** (Yarn-shaped:
`get` / `set` / `has` / `entries`). The runtime imposes no meaning on a name's
characters — scoping/prefixing is the host's policy. Storage is **installed once
on the controller** and **persists across plays** — so cycling-NPC counters,
quest flags, and anything written by `set` survive. (A choice's `once` flag is
*per-conversation*, not stored — a fresh `play()` clears it; it belongs to the
future save cursor.) `play(script)` is **content-only**.

- `script.declare` holds variable **defaults** (Yarn `<<declare>>` / `InitialValues`).
  On `play()` each seeds the storage **only if absent** — a game-linked value
  always wins, the addon never clobbers. To reset, re-init explicitly (`clear()` /
  a fresh instance).
- The default storage is `MemoryVariableStorage` (zero-config). Bridge game state
  with `cells({ gold: { get, set } })` (two-way) or `cells({ hp: () => player.hp })`
  (read-only), and `compose(cells(...), new MemoryVariableStorage())` to layer
  (writes to an unknown name land in the **last** storage — put a writable store
  last).

Conditions, `{token}` interpolation, and choice gates read the storage at
**line-present time** (an earlier command's effect shows on a later line);
already-shown lines never re-render, and a choice menu's conditions don't
live-refresh while open.

### Expression IR (conditions + `set` values)

`Condition`s and `set` values are expression **trees** (so `gold - 50` and
`has_item("key") and not rude` are plain data). Nodes: `literal | varRef | call
| unary | binary | group`. Operators (Yarn-modeled, word forms map 1:1):
`== != > < >= <=` (+ `eq/neq/gt/lt/gte/lte/is`), `and`/`&&` `or`/`||` `xor`/`^`,
`not`/`!`, `+ - * / %`. `+` concatenates when either side is a string. The atomic
`{ var, op, value }` stays valid as the degenerate one-level tree.

```ts
// "set gold = gold - 50" as data (needs a writable `gold` cell):
{ type: "set", var: "gold", value: { kind: "binary", op: "-",
  left: { kind: "varRef", name: "gold" }, right: { kind: "literal", value: 50 } } }
// a choice gated on an argument-read function:
{ condition: { kind: "call", fn: "has_item", args: [{ kind: "literal", value: "key" }] } }
```

### Validation (two hard-error stages)
- **Load-time** (`loadScript` / `defineScript`, environment-free): collects the
  names read/written, functions called, command types fired; type-checks what's
  statically knowable (atomic numeric op vs a declared non-number, a literal `set`
  value vs the target's declared type). Throws `DialogueScriptError`. Undeclared
  *references* are NOT rejected here — the storage/functions may provide them.
- **Play-time** (`validatePlay`, on `play()`): every read name must be provided
  (declared default or `storage.has`), every called function installed, every
  command type handled (`commands`/`fallbackCommand`), no `set` target that's a
  function, no declared-default/storage type conflict. Throws `DialoguePlayError`.

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

## Game state — storage / functions / commands, the typed handle out

Install the environment **on the controller**; `play(script)` is content-only.
Per-`play()` `overrides` layer on top (a scoped `storage` replaces; `functions`/
`commands` merge, call site wins).

```ts
const dlg = host.add(new DialogueController({
  ...createBoxDialogue(),
  storage: compose(
    cells({ gold: { get: () => player.gold, set: (v) => (player.gold = +v) } }), // two-way
    new MemoryVariableStorage(),                                                  // locals + seeds
  ),
  functions: { has_item: (id) => player.has(String(id)) },   // argument-read for conditions
  commands: {                                                 // game logic (rules in)
    "give-item": (cmd) => player.give(cmd.id),
    "skill-check": async (cmd, ctx) => ctx.setVar("passed", await roll(cmd.stat)),
  },
  fallbackCommand: (cmd) => log(cmd),                         // optional catch-all
}));
const handle = dlg.play(script);       // content-only
handle.setVar("rude", true);           // live poke (typed keyof declare); no-ops after stop/replay
handle.getVars();                      // snapshot of the storage's variables
```

- **`cells` getters/functions must be cheap + side-effect-free** — called on
  every condition test and present.
- **`ctx.setVar` / `handle.setVar` / `set`** all write through the storage
  (guarded). A read-only `cells` getter (no setter) throws. The **preferred path
  for game mutations is a command** (so game rules run): write-through `cells` is
  for when the *script* owns the arithmetic (`set gold = gold - 50`).
- `ctx.setVar(key, value)` is the skill-check seam — a blocking command computes a
  result a later condition reads.

### Commands — rules in, consequences out

Runner owns built-in `set` (writes the storage, guarded). Every other command
dispatches to `commands[type]` (or `fallbackCommand`) **and** fires
`DialogueCommandEvent` (observation). `ctx.mode` is `"play" | "skip"`. A `say`
line's commands fire by timing `at: "show" | "afterReveal" | "advance"` (default
`show`). `blocking: true` + an async handler pauses the conversation until it
resolves (cinematic sequencing). `{ type: "expression", value }` is the avatar
built-in (no handler needed). Every non-built-in command `type` a script uses
must resolve to a handler/fallback, else play-time error.

## DialogueController (L2a Component) — host owns focus/pause

```ts
new DialogueController({
  ...createBoxDialogue(theme),    // DialogueBundle: { chrome, text, choices, avatar?, skipMultiplier? }
  avatar,                          // optional AvatarPresenter override
  i18n,                            // optional I18nAdapter
  storage, functions, commands, fallbackCommand,  // installed once (see Game state)
  input,                           // optional InputBinding (default: KeyboardInputBinding)
  onEnded: () => {},
});
```

`DialogueController<TStorage>` is generic over its storage type (the seam for
future storage-aware checking; `play()` is typed by the script's declared vars).
Methods: `play(script, overrides?): DialogueHandle | undefined` (undefined if the
component was removed), `isActive()`, `stop()`, `skip()`,
`setAutoAdvance(ms | null)`, `preview(nodeId): PreviewedLine[]`, plus the three
lifecycle levers below. It is multi-instance friendly — several ambient
conversations can run at once; "which is interactive" and "does the world pause"
are the game's policy (no global singleton).

### Lifecycle levers (host owns focus/pause/visibility)

Three **orthogonal** levers; compose them (cutscene = hidden + paused; pause menu
= paused; ambient = inputDisabled). All host-level and **persistent** — they
survive `stop()`/`play()`, so a forgotten unhide/unpause stays in effect.

- `setHidden(bool)` — **visual only**. Hides/shows the whole UI without ending or
  freezing the conversation; state-preserving (hide mid-typewriter, show to
  resume the exact line + caret). A composite chrome restores its **active**
  variant on show (bubble line → bubble, not an empty box).
- `setPaused(bool)` — **freezes time + input**. `update()` no-ops (reveal,
  auto-advance clock, caret blink, avatar anim all halt) and the input-agnostic
  API no-ops; no state is lost (no generation bump; an in-flight blocking command
  keeps running and lands normally). Does **not** block host-driven
  `handle.setVar` / `ctx.setVar` / storage writes — only player-facing time/input
  freeze.
- `setInputEnabled(bool)` — **input focus**. `session.update` keeps pumping (an
  ambient conversation stays alive and animating) but the binding isn't polled,
  so this instance consumes no input. NOT `Component.enabled` (which would freeze
  the whole component).

```ts
// Two conversations, one interactive — focus is the game's one-liner.
// (YAGE input is non-consuming, so two ENABLED controllers both advance on one
// key press; focus is the game's policy by design.)
if (near(npcA)) { a.setInputEnabled(true);  b.setInputEnabled(false); }
else            { a.setInputEnabled(false); b.setInputEnabled(true);  }

// Cutscene takeover: hide + pause, pan the camera, then restore.
dlg.setHidden(true); dlg.setPaused(true);
await camera.panTo(spot);
dlg.setPaused(false); dlg.setHidden(false); // the bubble line + caret reappear
```

Channels carry a `setVisible(bool)` verb (the headless half of `setHidden`):
`TextChannel` / `ChoiceChannel` / `ChromeChannel` (required) + `AvatarChannel`
(optional). It is purely visual and state-preserving; `present(undefined)` means
"no line — clear content". The old `setNameplate(undefined)` covert hide-all is
gone (it now means only "no name").

### Missing actor vs narrator (bubble bundles)

A **speakerless narrator** line routes to the **box** in a mixed bundle
(`defaultCompositeRoute`, the genre convention) regardless of `view`; a
*positioned* narrator is the documented **invisible-anchor** recipe — give the
narrator a `speaker` whose `DialogueActor` rides an invisible entity, and it
floats like any other speaker. A **missing actor** (speaker declared but the
`DialogueActor` despawned/unregistered) no longer renders invisibly at world
origin: the bubble anchors at the actor's **last-known** position (despawn), else
the most recent any-speaker anchor, else `createBubbleDialogue`'s
`fallbackAnchor` (world origin by default — point it at your camera centre for
pure-bubble narrator bundles); the bubble, text, choices, and caret stay
**visible**, and a once-per-speaker dev warning routes through the engine
`Logger`. `BubbleAnchorResolver` is the single shared owner of this policy.

Events (entity → scene bubbling): `DialogueStartedEvent`, `DialogueLineEvent`
(`{ speaker?, text }` plain text), `DialogueChoiceShownEvent`,
`DialogueChoiceMadeEvent`, `DialogueCommandEvent` (`{ command, mode }`),
`DialogueEndedEvent`, and four observation events — `DialogueRevealCompletedEvent`
(`{ speaker?, text }`, "typing finished"), `DialogueSelectionChangedEvent`
(`{ index, text }`, keyboard nav **and** pointer hover), `DialogueSkipUsedEvent`
(`{ scriptId }`), `DialogueAutoAdvanceEvent` (`{ scriptId }`). Observation is
events-only: the reveal-completed seam is session-owned (no public mutable field
a game can clobber).

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
cursor. (`handle.getVars()` IS reachable, but it's the variable snapshot, not a
resumable cursor.) The storage model makes the future API purely additive: a
cursor is `{ nodeId, stepIndex, chosenOnce }` + the in-memory default store's
contents (game-backed `cells` serialize through the game's own save). Save
outside conversations (or replay the script) until v1.1 adds the seam.
