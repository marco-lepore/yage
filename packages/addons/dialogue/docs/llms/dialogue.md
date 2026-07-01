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
are optional peers (only the `./presenters` subpath needs them). `yaml` is the
addon's one bundled runtime dep, pulled ONLY by the `./yaml` subpath.

## Three entry points (export split — load-bearing)

- **`.`** (root) — headless + non-pixi. Runner, session, types, markup, i18n,
  canonical (JSON) format, the string→expression parser (`parseExpr`), the compact
  DSL (`parseCompact` / `loadCompact`), events, `DialogueController` (a `@yagejs/core`
  Component), `@yagejs/input` bindings. **MUST NOT transitively import pixi /
  renderer / `yaml`.**
- **`./presenters`** — everything pixi. Chrome, text views, composites, avatars,
  factories, `defaultTheme()`, textured nine-slice variants, experimental radial.
- **`./yaml`** — the YAML-literal loader (`loadYaml`). The ONLY entry that pulls
  `yaml`. Kept off the root so JSON / TypeScript / expression authors never bundle
  the parser (`yaml@2` isn't side-effect-free, so a root re-export couldn't be
  tree-shaken).

```ts
import { DialogueController, parseExpr, loadCompact } from "@yagejs-addons/dialogue";
import { defaultTheme, createBoxDialogue } from "@yagejs-addons/dialogue/presenters";
import { loadYaml } from "@yagejs-addons/dialogue/yaml";
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
  speakers: { gwen: { name: "Gwen", color: 0xffd866 } },
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

`SpeakerDef`: `{ name, nameKey?, color?, avatar? }`. The speaker's **id is its
key** in `speakers` — steps reference it (`speaker: "gwen"`) and presenters anchor
actors by it; the loader stamps it on, so never write `id` inside the entry.

Step kinds: `say` | `choice` | `command` | `goto` | `end`.
- `SayStep`: `text` (+ optional i18n `key`), `speaker?`, `expression?`, `speed?`,
  `autoAdvanceMs?`, `commands?`, `view?`, `meta?`, `voice?`.
- `ChoiceOption`: `text`, `target?`, `condition?`, `once?`, `presentation?`
  (`"hidden"` default | `"disabled"`), `disabledReason?`, `commands?`, `meta?`.
- `CommandStep`: `commands` (+ optional `condition`/`target` conditional jump).
- `Condition`: a **string expression** (`"hp > 0 and has_item('key')"`, parsed at
  load — see below), the atomic `{ var, op, value }` (op = `== != > >= < <= truthy
  falsy`), an `Expr` tree, or `(vars) => boolean` (TS-only, not JSON; receives a
  materialized snapshot). A bare name (`"greeted"`) is the degenerate string
  expression → a truthy read (back-compat).

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
- `createRecordStorage(record: Record<string, string | number | boolean>)` —
  `VariableStorage` over a plain non-null record you own (a reactive store leaf, a
  save blob). `get`/`has`/`entries` are own-property only; the record is mutated in
  place. A `set(name, null)` from the runtime **deletes** the key (null = unset) so
  the record stays typed non-null; any other value writes through.

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

### String authoring — `parseExpr` (the canonical reading of every string)

`parseExpr(src): Expr` parses a condition / `set`-value string into the IR above
(no new node kinds). It is **purely syntactic** — no type-checking, no name
resolution — so a future Yarn front-end reuses it 1:1. Throws `DialogueExprError`
(carries `line` / `col`) on a bad source.

`loadScript` / `loadYaml` run `parseExpr` over **every** string condition and
string `set` value at load (a one-pass pre-walk), for every loader incl. JSON, so
the frozen IR only ever holds trees and the runtime never re-parses.

```ts
parseExpr("hp > 0 and has_item('key')");
// → binary && ( binary > (varRef hp, literal 0), call has_item(literal "key") )

// In a script — authored as strings, identical to the hand-built IR above:
{ kind: "command", commands: [], condition: "hp > 0 and has_item('key')", target: "fight" }
{ type: "set", var: "gold", value: "gold - 50" }   // string set RHS → Expr
```

- **Identifiers** lex as `[A-Za-z_$]` then `[A-Za-z0-9_.$]` — `.`/`$` are name
  chars (`$gold`, `quest.stage` are ONE name, Yarn-forward); `-` is NOT, so `hp-1`
  is `hp` minus `1`. An item id with a hyphen lives in a quoted string:
  `has_item('rusty-key')`.
- **Bare string = a `varRef`** (a truthy read — back-compat with the old
  string-condition behavior). A **quoted** string is a string literal: a `set`
  value `"gold"` reads variable `gold`; `"'gold'"` is the literal text. Operator
  strings (`"not rude"`, `"a or b"`) that the old runtime silently failed on now
  work.
- **Reserved words** (can't be referenced *bare in a string* — use `{ var, op,
  value }`, `defineScript`, or rename): `and or not xor is eq neq gt lt gte lte
  true false null`.
- v1 wires `or/|| and/&& not/!`, the comparisons (+ word forms), unary `-`, binary
  `+ -`, calls, and parens. `xor/^` and `* / %` are reserved but unwired (additive
  later — the IR + evaluator already accept them). Word forms normalise to symbols
  in the IR (`and` → `&&`, `eq` → `==`, …).

### YAML authoring — `loadYaml` (the `./yaml` subpath)

`loadYaml(text): DialogueScript` (from `@yagejs-addons/dialogue/yaml`) parses a
YAML document whose shape mirrors the JSON `DialogueScript` and hands it to
`loadScript` — same pre-walk, validation, and frozen IR as JSON. The root must be
a mapping; a null / scalar / array / empty document → a YAML-specific
`DialogueScriptError`. String conditions/`set`s resolve exactly as above.

```ts
import { loadYaml } from "@yagejs-addons/dialogue/yaml";

const script = loadYaml(`
id: shop
start: greet
nodes:
  greet:
    id: greet
    steps:
      - kind: say
        text: "You have {gold} gold."
      - kind: choice
        options:
          - { text: "Buy the sword (50g)", target: buy, condition: "gold >= 50" }
          - { text: "Leave", target: bye }
  buy: { id: buy, steps: [ { kind: command, commands: [ { type: set, var: gold, value: "gold - 50" } ] }, { kind: end } ] }
  bye: { id: bye, steps: [ { kind: end } ] }
`);
```

### Compact authoring — `parseCompact` / `loadCompact` (root entry)

A line-oriented DSL for RPG branching, compiled to the same IR. `parseCompact(text):
DialogueScript` builds the model; `loadCompact(text)` runs it through `loadScript`
(same pre-walk, validation, frozen IR). Both are on the **root** entry — no `yaml`
dep. One statement per line; blank lines and `// comment` lines are ignored;
indentation is insignificant.

| Line | → |
| --- | --- |
| `# id` | script id (required, once); start node = the first `::` node |
| `@ id Name [#hex]` | a speaker: opaque id, display name (spaces ok), optional nameplate colour (`#ffcc00` / `#fc0`) |
| `:: nodeId` | open a node; following step lines belong to it |
| `speaker: text` · `speaker face: text` | a `say` line — ONLY when the first token is a declared `@`-speaker; a 2nd header token → `SayStep.expression` (the avatar face) |
| `text` | a narrator `say` line (no declared-speaker prefix — colons and all stay in the text) |
| `? text …` | a choice option; consecutive `?` lines coalesce into one `choice` step |
| `-> nodeId [if: cond]` | a jump — unconditional, or conditional (taken only if `cond` holds, else fall through to the next step) |
| `declare v = value` | a script-level variable default (a literal scalar; `parseExpr` is NOT applied — declare values are plain values, seeded if-absent) |
| `set v = rhs` | write a variable (bare number / `true` / `false` / `null` stays literal, else `parseExpr`) |
| `do type k=v … #flag` | a host command — `type`, then `key=value` data and `#flag` booleans (a data key can't be `type` — that's the dispatch key; a `type=` collision is a load error) |
| `end` | end the conversation |

**Say-line hints** ride the end of the line: `view=` / `voice=` / `speed=` / `auto=`
→ the first-class `SayStep` fields; trailing `#key:value` / bare `#flag` → `SayStep.meta`
(Yarn-aligned — metadata is trailing); `#line:id` is special — it sets the i18n `key`
(Yarn's localization tag), not `meta`, on a say line or a choice option. Say text is
otherwise handed to markup **verbatim**, so inline `[..]` (and any tokens a later
release adds) survives.

**Choice attributes** come after the text, in this order: `if: cond`, then `-> target`
(or `target=node`), then `#once` / `#disabled` / `#key:value`. They are lexed off and
stripped before the choice text reaches markup — `[..]` is markup-only in a choice, so
an unrecognized bracket tag is a load error (almost always a mistyped attribute that
markup would otherwise drop silently). `#once` → `once: true`; `#disabled` →
`presentation: "disabled"`; `#key:value` → `ChoiceOption.meta`.

Conditions and non-literal `set` values go through `parseExpr` (same operators;
`DialogueExprError` on a bad expression). The `set` / `do` / `end` leaders are
lowercase and matched by full shape, so prose like `Set the table.` or `Do you agree?`
falls through to narrator text.

```ts
import { loadCompact } from "@yagejs-addons/dialogue";

const script = loadCompact(`
# shop
@ mira Mira Brightwater #ffcc00

:: start
mira: Welcome to my [b]shop[/b], traveler!
mira happy: Got coin to spend?
set gold = 100
? Buy a potion if: gold >= 50 -> buy #once
? Ask about [i]rumors[/i] -> rumors #side:right
? Just browsing -> done

:: buy
set gold = gold - 50
do give-item id=healing-potion count=1
-> done

:: rumors
The shopkeeper leans in close.
-> done

:: done
mira: Safe travels!
end
`);
```

### Validation (two hard-error stages)
- **Load-time** (`loadScript` / `defineScript`, environment-free): collects the
  names read/written, functions called, command types fired; type-checks what's
  statically knowable (a numeric/arithmetic op — atomic OR inside an expression
  tree — with a wrong-type literal operand or a declared-non-number var operand; a
  literal `set` value vs the target's declared type). Throws `DialogueScriptError`.
  Undeclared *references* are NOT rejected here — the storage/functions may provide
  them.
- **Play-time** (`validatePlay`, on `play()`): every read name must be provided
  (declared default or `storage.has`), every called function installed, every
  command type handled (`commands`/`fallbackCommand`), no `set` target that's a
  function, no declared-default/storage type conflict. Throws `DialoguePlayError`.

### Disabled choices (greyed, non-selectable)

`ChoiceOption.presentation` decides what a **false condition** does. Default
`"hidden"` filters the option out (the original behavior); `"disabled"` keeps it
on screen greyed-out and non-selectable — the Disco-Elysium "[Strength 8] Force
the door" pattern, so the player learns the gate exists. `disabledReason?: string`
shows beside the row where the layout allows (i18n-resolved: `{token}`s
interpolate; there is no separate i18n `key`). `PresentedChoice` carries
`disabled?` / `disabledReason?` for presenters.

- A spent `once` option is **always** hidden — `presentation` governs condition
  failures only, never a consumed one-shot.
- A step whose ENABLED count is zero is **skipped** (same fall-through as the
  all-hidden path) — a disabled row never soft-locks; it needs ≥1 enabled sibling.
- The Session starts the highlight on the **first enabled** row;
  `moveSelection`/`selectAt` skip disabled rows (a multi-row skip fires ONE
  `DialogueSelectionChangedEvent`, for the landed row); `confirm` / `choose` /
  the pointer commit refuse a disabled row.
- Default presenters grey disabled rows and append the reason in parentheses
  (list + bubble); the experimental radial wheel greys without a reason.

## Inline markup (`parseMarkup` / `stripMarkup`)

BBCode-ish, survives translation, nests. Styling attributes are a **fixed set** —
`[b]` `[i]` `[color=#ffcc00]`/`[color=gold]` `[speed=2]`. **Effects are an open
vocabulary**: `[wave]` `[shake]` `[pulse]` `[rainbow]` are the four the bundled
presenter animates, but any other `[name]…[/name]` opens an effect span named
`name` (`RunStyle.effect` is an open `string`) — a presenter that doesn't recognise
the name (including the bundled one) renders the run as plain styled text. `\[`
escapes a literal bracket. (NOTE: ruby/furigana and glossary `[term]`/`[gloss]`
markup were removed — they now parse as ordinary effect spans the bundled presenter
renders as plain text, so old scripts still parse.)

**Self-closing tokens** (a trailing `/`) are the reveal-timeline controls — a
`[pause=600/]` hold and a `[name k=v/]` marker. They share **one ordered stream**
(`ParsedText.tokens: RevealToken[]`, each `{ kind: "pause" | "marker", atChar, … }`),
so **source order is drain order**:
- `[pause=600/]` holds the typewriter 600ms at its offset (the only pause spelling
  now — a bare `[pause=600]` without the slash opens an effect span named `pause`,
  not a hold).
- `[sfx=ding/]`, `[expression=happy/]`, `[shake amount=3/]` fire as **reveal events**.
  The self-named shortcut `[name=val/]` ≡ `[name name=val/]` (Yarn), so it composes
  with explicit props: `[shake=500 amount=3/]` → `{ shake: "500", amount: "3" }`.
  Values/props can't contain whitespace or `/`.
- `[pause=600/][shake/]` holds **then** fires; `[shake/][pause=600/]` fires **then**
  holds. The "effect + hold" idiom is just `[shake=500/][pause=500/]` — fire a marker
  (host plays a 500ms shake), then a 500ms pause holds while it plays. Markers are
  non-blocking; the pause is the only timing primitive (no combined `[shake hold/]`).

Translators **must keep the trailing `/`** so a token survives a re-order. A
*non*-self-closing tag that isn't a built-in styling attribute opens an effect span
(open vocabulary); a self-closing token is never dropped.
See **Reveal events** below for where markers surface.

All character counts are **graphemes** (user-perceived characters, via
`Intl.Segmenter` — the same segmentation pixi's SplitText renders one glyph
per): `ParsedText.length`, `TextRun.graphemeCount`, a token's `atChar`, and the
reveal rate (`charsPerSec` = graphemes/second). An emoji, ZWJ sequence, or
base+combining-mark cluster counts as 1. `splitGraphemes(str)` is exported.

### Reveal events (per-grapheme ticks + inline markers)

The headless `LineReveal` clock emits a `RevealBeat` stream as the cursor advances:
- a **`tick`** per revealed grapheme — surfaced as the controller `onRevealTick(index)`
  **callback** (NOT an entity event; it fires hundreds of times per line). `index` is the
  raw grapheme index, whitespace included — the host filters. Wire a typewriter SFX here.
- a **`marker`** when the cursor reaches a `[name k=v/]` offset — surfaced as
  `DialogueRevealMarkerEvent` (`{ marker, viaSkip }`) on the entity bus. `viaSkip` is true
  when a skip / complete drained it (suppress a loud one-shot). A skip drains pending
  **markers** (consequences still fire) but **discards** pending ticks (no machine-gun).

The addon **name-matches no marker**: the avatar channel interprets `[expression=…/]`
itself (the bundled portrait/scene presenters call their own `setExpression`), and every
other name (`sfx`, …) flows opaquely to the host and to registered channels. A registered
`DialogueExtraChannel` sees the whole stream via the optional `revealBeat?(beat)` hook (a
typewriter-SFX or CameraEffects channel reacts there). A custom text presenter forwards
beats off `LineReveal` via `setBeatListener`.

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
resolves (cinematic sequencing). Every non-built-in command `type` a script uses
must resolve to a handler/fallback, else play-time error. (There is **no**
`expression` command — `set` is the only built-in. A mid-line face change is the
`[expression=…/]` reveal marker; the line-initial face is `SayStep.expression`.)

## DialogueController (L2a Component) — host owns focus/pause

```ts
new DialogueController({
  ...createBoxDialogue(theme),    // DialogueBundle: { chrome, text, choices, avatar?, skipMultiplier? }
  avatar,                          // optional AvatarPresenter override
  i18n,                            // optional I18nAdapter
  storage, functions, commands, fallbackCommand,  // installed once (see Game state)
  input,                           // optional InputBinding (default: fullControls() — keyboard + pointer)
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
`DialogueEndedEvent`, `DialogueRevealMarkerEvent` (`{ marker, viaSkip }`, an inline
`[name k=v/]` reveal marker — see **Reveal events**), and four observation events —
`DialogueRevealCompletedEvent` (`{ speaker?, text }`, "typing finished"),
`DialogueSelectionChangedEvent` (`{ index, text }`, keyboard nav **and** pointer
hover), `DialogueSkipUsedEvent` (`{ scriptId }`), `DialogueAutoAdvanceEvent`
(`{ scriptId }`). Per-grapheme **ticks** are NOT an event — wire the controller
`onRevealTick(index)` callback option (it fires hundreds of times per line; the host
filters whitespace). Observation is events-only: the reveal-completed seam is
session-owned (no public mutable field
a game can clobber).

## Timed choices — a recipe, not a feature

There is no `timeoutMs` in the model. Express a timed choice with a non-blocking
`choice-timer` command before the choice step: the host arms a timer **on its own
clock** and commits a default with `controller.choose(default)` on expiry. The
one addon hook is `ChoiceContext.meta` — the choice step's `meta` passes through,
so a custom choice presenter can render a countdown from `meta.timeoutMs`.

```ts
// script: a non-blocking timer command, then the choice (meta carries the budget)
{ kind: "command", commands: [{ type: "choice-timer", ms: 5000, default: 1 }] },
{ kind: "choice", text: "Quick!", meta: { timeoutMs: 5000 }, options: [
  { text: "Fight", target: "fight" },
  { text: "Hesitate", target: "hesitate" }, // index 1 = the default on timeout
] },

// host: the timer rides YOUR clock; arm/cancel off the dialogue events.
let pending: { ms: number; def: number } | undefined;
let remaining = -1, def = 0;
const commands = { "choice-timer": (c) => { pending = { ms: Number(c.ms), def: Number(c.default) }; } };
host.on(DialogueChoiceShownEvent, () => {   // dangling-timer guard — re-arm/cancel here
  remaining = -1;                            // drop any prior timer FIRST…
  if (pending) { remaining = pending.ms; def = pending.def; pending = undefined; } // …then re-arm if timed
});
host.on(DialogueChoiceMadeEvent, () => { remaining = -1; pending = undefined; });
host.on(DialogueEndedEvent,      () => { remaining = -1; pending = undefined; });
// in your own update(dt): pause it yourself when you pause the conversation
if (remaining >= 0 && !paused) { remaining -= dt; if (remaining <= 0) { remaining = -1; controller.choose(def); } }
```

- **Re-arm/cancel on every `DialogueChoiceShownEvent`** is load-bearing: without
  it a timer armed for one menu fires into a LATER, unrelated menu.
- The timer is on the **host** clock, so `setPaused` does NOT freeze it — pause
  your own timer with whatever pauses the conversation.
- `default` must be an **enabled** option index (a disabled/filtered one is refused).

## Channels + presenters (L3 capability channels)

Headless channels (core): `TextChannel`, `ChoiceChannel`, `AvatarChannel`,
`ChromeChannel`. Presenter adapters add the YAGE lifecycle (`mount`/`dispose`)
and pointer seams: `TextPresenter`, `ChromePresenter`, `ChoicePresenter`.
Defaults: `DialogueChrome`, `ChoiceListPresenter`, `BoxTextView` (box);
`BubbleChrome`, `BubbleChoicePresenter`, `BubbleTextView` (world). Avatars:
`PortraitPresenter`, `SceneFigurePresenter`, line-driven `InBoxAvatarPresenter`
(box, reflows the text) + `BubbleAvatarPresenter` (a portrait inside the bubble, text reflows),
`NullAvatarPresenter`; `DialogueActor` (component on a world entity, self-registers
by speaker id) + `actorRegistryFor(scene)`.

- **Layout owners** (one per coordinate model, behind `./presenters`):
  `BubbleLayout` is the single source of bubble sizing + speaker anchor (incl. the
  missing-actor fallback) + origin — measured **once** per line and shared by the
  bubble chrome/text/choices (no drift). `BoxLayout` owns the box frame rect +
  text region: per-line `meta.position`, the unified panel grow (a choice grows
  the frame/nameplate/prompt/rows as one), and an **inset registry** the in-box
  avatar reflows the text — and the choice rows — around.
- **Routing** (mixed bundles): the four composites (chrome/text/choices/avatar)
  share one `route: (line) => "box" | "bubble"`. Default = narrator → box; explicit `view`
  wins for a real speaker; else a registered `DialogueActor` → bubble, otherwise
  box. Override in one place via `createMixedDialogue(theme, { route })`.
- **`LineReveal`** (core, pixi-free): the typewriter clock — grapheme cursor, the
  ordered `tokens` drain (a `[pause=N/]` holds, a `[name k=v/]` marker fires a
  beat), per-run/line `[speed]`, hold multiplier, fired-once completion.
  `DialogueTextView` consumes it; a custom presenter reuses it (forwards beats via
  `setBeatListener`).

`DialogueTextView` renders one `SplitTextComponent` per line, maps `LineReveal`'s
grapheme cursor onto glyph visibility (`chars[i].visible`), and applies per-run
colour/bold/italic and per-glyph effects.

## Writing a custom presenter

A presenter implements the channel contract; the Session drives it. The
**call order** per line is guaranteed: `chrome.present(line)` **before**
`text.present(line)` (so a composite/layout owner commits first); geometry
(`setBox`) is applied before `present`; the text channel fires its
`setRevealListener` callback **exactly once** per line (synchronously for an empty
line) — the Session owns that seam, so never expose a public reveal field.

Reuse `LineReveal` for reveal timing rather than re-implementing it — a DOM /
per-word / accessibility presenter then only maps its grapheme cursor onto its own
rendering:

```ts
import { LineReveal, splitGraphemes, type TextChannel, type PresentedLine } from "@yagejs-addons/dialogue";

class DomTextPresenter implements TextChannel {
  private reveal = new LineReveal(/* charsPerSec */ 45);
  private graphemes: string[] = [];
  private el = document.querySelector("#line")!;
  constructor() { this.reveal.setCompletionListener(() => this.onDone?.()); }
  private onDone?: () => void;
  setRevealListener(fn: (() => void) | undefined) { this.onDone = fn; }
  present(line: PresentedLine) {
    this.graphemes = splitGraphemes(line.text.runs.map((r) => r.text).join(""));
    this.reveal.begin(line.text, line.speed);
  }
  update(dt: number) {
    this.reveal.update(dt);
    this.el.textContent = this.graphemes.slice(0, Math.floor(this.reveal.revealed)).join("");
  }
  completeReveal() { this.reveal.complete(); }
  isRevealComplete() { return this.reveal.isComplete(); }
  isRevealing() { return this.reveal.isRevealing(); }
  setSpeedMultiplier(m: number) { this.reveal.setSpeedMultiplier(m); }
  setVisible(v: boolean) { (this.el as HTMLElement).style.visibility = v ? "visible" : "hidden"; }
  clear() { this.el.textContent = ""; }
}
```

A line-driven presenter (avatar/chrome) implements the optional `present(line)`
and reads `line.meta`. The shipped avatar references: `InBoxAvatarPresenter`
reserves a text column via `BoxLayout.setInset(key, { side, width })` so the body
text + choice rows reflow around it (`background?` for a panel); `BubbleAvatarPresenter`
reserves a portrait column inside the bubble (`BubbleLayout.setPortraitInset`) so
the bubble (and a bubble choice panel) grows + its text/rows reflow. Wire per side; a `CompositeAvatarPresenter`
routes box-vs-bubble like the other composites:

```ts
createMixedDialogue(theme, {
  worldLayer: "world",
  avatar: {
    box: (layout) => new InBoxAvatarPresenter(layout, { layer, width: 84, background: { color } }),
    bubble: (layout) => new BubbleAvatarPresenter(layout, { layer: "world", size: 56 }),
  },
});
// box-only: createBoxDialogue(theme, { avatar: (layout) => new InBoxAvatarPresenter(...) })
```

## Extra channels — register Voice / Shop / camera FX (additive)

Beyond the typed trio, a host **registers** open-ended `DialogueExtraChannel`s on a
running conversation — voice-over, a shop reacting to a `buy` command, a camera
shake, a history recorder. Every method is **optional**; a one-method observer
implements just what it needs. Purely additive (the trio is untouched).

```ts
interface DialogueExtraChannel {
  present?(line: PresentedLine): void;        // a say line presented (read line.voice/meta) — NOT choices
  revealComplete?(line: PresentedLine): void; // the say line finished revealing
  revealBeat?(beat: RevealBeat): void;        // a per-grapheme tick or an inline [name k=v/] marker
  command?(command, ctx): void;               // a non-built-in command fired (never set)
  clear?(): void;                             // conversation stopped/ended (per-conversation reset)
  setVisible?(visible: boolean): void;        // the host setHidden lever
  setPaused?(paused: boolean): void;          // the conversation paused/resumed
  completeReveal?(): void;                    // player skipped the typewriter / section
  update?(dt: number): void;                  // per-frame (already gated by pause)
  dispose?(): void;                           // final teardown (distinct from clear)
  isRevealComplete?(): boolean;               // gates auto-advance (see below); omit → pure observer
}
```

Register via the controller (mounts a scene-needing channel, returns a disposer):

```ts
const off = controller.addChannel(channel);  // or: new DialogueController({ ..., channels: [voice] })
// ...later:
off();                                        // unregister + dispose
```

- A channel that also needs the scene implements `Mountable` (`mount(scene)` /
  `dispose()`, re-exported from the **root**) — the controller mounts it in `onAdd`,
  disposes it in `onDestroy`. A pure observer (Voice / Shop) skips `Mountable`.
- On register a channel catches up the `setVisible` / `setPaused` levers **only** —
  no `present` replay (that would restart a clip). `present` fans out for **say
  lines only**, not choice prompts.
- **Consequences out, one back-channel in.** A channel mutates game state via
  `ctx.setVar` (write-only) and reads it back through the host-held
  `handle.getVars()` — never the session. The ONLY value it hands the session is
  `isRevealComplete()`.
- Each fanned-out hook is wrapped → a throwing channel routes to the session
  `onError`, never breaking the conversation (the trio stays trusted/unwrapped).

### Auto-advance gate (arm-on-text, count-on-aggregate)

A channel's `isRevealComplete()` joins the auto-advance gate: the clock is **armed**
when the **text** reveal completes, but **counts down** only once text AND every
registered gater report complete. So a voice clip outlasting the typewriter holds
the line for **`max(clipEnd, revealEnd)`** — no duration plumbing. A **manual**
advance is never gated (a player can always mash forward). A channel without
`isRevealComplete` never gates.

### `createVoiceChannel` — voice-over as a gating channel

```ts
import { createVoiceChannel } from "@yagejs-addons/dialogue";

const voice = createVoiceChannel({
  // The addon owns NO audio — wire `play` over @yagejs/audio in the game. Map the
  // line's voice id → a preloaded clip; @yagejs/audio's `onEnd` fires onEnded on
  // NATURAL completion (not on stop()). Pause/resume is the handle's `paused` setter.
  play: (id, onEnded) => {
    const h = audio.play(clips[id], { channel: "voice", onEnd: onEnded });
    return { stop: () => h.stop(), pause: () => (h.paused = true), resume: () => (h.paused = false) };
  },
  onSkip: "cut",                  // "cut" (default) stops + releases on skip; "ring" plays out
  pauseWithConversation: true,    // default: pause the clip when the conversation pauses
  livenessMs: 30_000,             // optional safety cap: force-release if onEnded never arrives
  onError: (m, e) => log.warn(m), // liveness diagnostics
});
controller.addChannel(voice);
// script: { kind: "say", text: "...", voice: "vo_intro_01" }
```

`createVoiceChannel({ play, onSkip?, pauseWithConversation?, livenessMs?, onError? })`
→ a `DialogueExtraChannel`. `play(id, onEnded) => { stop; pause?; resume? }`. It reads
`PresentedLine.voice` in `present`, gates `isRevealComplete()` on the clip, and is
hardened: a late `onEnded` from a superseded clip can't ungate the next line
(generation guard); the optional `livenessMs` cap stops a wedged host soft-locking
auto-advance.

### Worked: a Shop channel (rules in, consequences out)

```ts
controller.addChannel({
  command(cmd, ctx) {
    if (cmd.type !== "buy") return;
    ctx.setVar("owns_" + cmd.item, true);   // consequence-out (write-only ctx)
  },
});
const handle = controller.play(shopScript); // script fires { type: "buy", item: "sword" }
handle?.getVars();                           // host reads { owns_sword: true } back
```

The `buy` type still needs a registered handler/fallback to validate — the channel
adds its consequence on top of the command pipeline.

### Worked: a command-driven CameraEffects channel

A `{ type: "shake" }` command in the script reaches a channel's `command?()` with
**zero** addon change:

```ts
controller.addChannel({
  command: (cmd) => { if (cmd.type === "shake") camera.shake(Number(cmd.power ?? 8)); },
});
// script: { kind: "command", commands: [{ type: "shake", power: 12 }] }
```

> An **inline** `[shake/]` reveal marker (fire mid-line at a char offset) depends on
> the reveal-event feature (not yet shipped); the command path above works today.

### Save / restore (v1.1, document-only)

A mid-line restore **re-presents** the current line, so `present()` re-fires to the
extras. `createVoiceChannel.present()` stops any active clip first, so a restore
restarts the line's clip cleanly (the restore-safety property). Build nothing now.

## Line `meta` keys the default presenters read

`meta` is the opaque per-line bag (`SayStep.meta`); the default presenters read a
small documented set. Unknown keys are ignored. YAML writes `meta` directly; Yarn
uses `#key:value` hashtags (unrecognised hashtags already fold into `meta`).

- `meta.chrome` — box frame style (named / `none` / default; see Theming).
- `meta.position` — box vertical position: `top | center | bottom` (default
  `bottom`). Moves the frame **and** the body text together.
- `meta.portrait` / `meta.side` / `meta.presence` — read by the avatar presenters
  (`InBoxAvatarPresenter` box / `BubbleAvatarPresenter` bubble): texture key,
  `left|right` (default left), and `presence:false` to speak from off-screen
  (portrait hidden, no inset).

```yaml
- { speaker: hero, text: "From up top.", meta: { position: top } }
- { speaker: hero, text: "You made it.", meta: { portrait: hero_smug, side: right } }
```

```
Hero: From up top. #position:top
Hero: You made it. #portrait:hero_smug #side:right
```

`view` stays the coarse box/bubble selector; these `meta` keys are fine-grained
hints within a variant.

## Input (root entry, `@yagejs/input` — not pixi)

`KeyboardInputBinding(actions?, skipHoldMs?)`, `PointerInputBinding(choiceTarget?)`,
`CompositeInputBinding`, `fullControls(choiceTarget?, { actions?, skipHoldMs? })`.
Zero-config default (no `input` option) is `fullControls()` — keyboard + pointer
(tap-to-advance), `FULL_ACTIONS`, no choice geometry (can't hit-test rows). Actions:
`DEFAULT_ACTIONS` (advance/speed/up/down), `FULL_ACTIONS` (+ skip). Default keyboard
action names are kebab-case (`interact`/`attack`/`move-up`/`move-down`/`skip`) — an
unmapped name silently never fires; a FULL mismatch with the live `InputManager` map
logs a dev-mode warning at startup. Wire a custom map by passing
`input: fullControls(choices, { actions })`. `KeyboardInputBinding.actionNames()` and
`CompositeInputBinding.actionNames()` expose the polled names. `skipHoldMs > 0` is the
classic hold-to-confirm skip (default `0` = fire on press); fast-forward is the
`speed` action held. `PointerChoiceTarget` lets a pointer binding hit-test choice
rows without owning geometry. There is no binding-free path; an
ambient/auto-advancing conversation calls `setInputEnabled(false)` rather than
omitting the binding.

## Theming

`DialogueTheme` is one flat data object: `box` (**viewport-relative**
`{ marginX, marginY, height }` — a full-width bottom bar resolved against the
renderer's design size at mount, so the default works at ANY resolution with no
override; `meta.position` reuses the margins), `padding`, frame colours
(`frameColor/frameAlpha/borderColor/cornerRadius`), `nameColor/Size`,
`indicatorColor`, `caret?` (`{ blinkMs?, size? }`),
`textSize/lineHeight/textColor/charsPerSec`, choice colours, `choiceGap?`,
`tailLean?` (bubble tail tip), fonts (`bitmapFont/fontFamily/resolution` — the
shared `FontConfig` triplet every presenter config extends), `layerFrame/layerText`,
`skipMultiplier?`, `textured?`. `defaultTheme()` returns a fresh zero-asset
instance — spread to tweak: `{ ...defaultTheme(), textColor: 0xff0000 }`.
Presenter-config field names match theme field names exactly (theme `frameColor`
→ config `frameColor`), so the mapping is mechanical; a test asserts every theme
field reaches a presenter.

- **Default**: Graphics chrome + canvas text (`fontFamily`). Zero assets.
- **Bitmap fonts** (opt-in): set `bitmapFont` (baked via `installBitmapFont`)
  for a crisp pixel atlas. Bold/italic are synthesised on the regular atlas
  (skew + double-draw); there are no variant-atlas fields.
- **Textured nine-slice** (opt-in): `theme.textured` is a MAP of named
  `ChromeStyle`s — `{ frame: { texture, insets }, bubble?: { texture, insets } }`
  — drawn through renderer's `createNineSlice` (no pixi peer; `texture` is an
  asset key or `Texture`, `insets` the four nine-slice border widths). The box
  frame is chosen **per line** by its `meta.chrome` key: a named style → that
  nine-slice; the built-in `"none"` → no frame (full-bleed line); missing/unknown
  → the `"default"` style's frame if present, else the drawn Graphics rect. The
  speech bubble renders the `"default"` style's `bubble` (content-sized per line);
  `meta.chrome` is box-only.

```ts
const theme = {
  ...defaultTheme(),
  textured: {
    default: {
      frame: { texture: "ui/box", insets: { left: 16, top: 16, right: 16, bottom: 16 } },
      bubble: { texture: "ui/bubble", insets: { left: 12, top: 12, right: 12, bottom: 12 } },
    },
    parchment: { frame: { texture: "ui/parchment", insets: { left: 16, top: 16, right: 16, bottom: 16 } } },
  },
};
```

The `meta.chrome` key — YAML writes `meta` directly; Yarn uses a `#chrome:`
hashtag (unrecognised hashtags already fold into `meta`):

```yaml
- { speaker: hero, text: "An ornate proclamation.", meta: { chrome: parchment } }
- { text: "The cave swallows your words.", meta: { chrome: none } }
```

```
Hero: An ornate proclamation. #chrome:parchment
The cave swallows your words. #chrome:none
```

**Choice overflow + unified panel**: the box **frame grows** to fit the choice
rows (+ prompt + nameplate) as one panel (labels word-wrap; multi-line rows
allowed). For `position:bottom` the bottom edge is pinned and the top rises; the
grow is capped at the screen, and a menu taller than that spills off the top
non-overlapping. Row placement, the highlight, and pointer hit-testing all derive
from the layout owner's one geometry pass, so a long list can't escape its
hit-targets. A list longer than `softMaxChoices` (default 8) logs a soft-cap
advisory but still renders.

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
