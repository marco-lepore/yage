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

## Script model (plain JSON-able data)

```ts
const script: DialogueScript = {
  id: "intro",
  start: "n1",
  vars: { metBefore: false },
  speakers: { gwen: { id: "gwen", name: "Gwen", color: 0xffd866 } },
  nodes: {
    n1: { id: "n1", steps: [
      { kind: "say", speaker: "gwen", text: "Hello, [b]traveler[/b]." },
      { kind: "choice", text: "Well?", options: [
        { text: "Hi.", target: "n2" },
        { text: "Leave.", once: true, commands: [{ type: "set", var: "rude", value: true }] },
      ] },
    ] },
    n2: { id: "n2", steps: [{ kind: "say", text: "Safe travels." }, { kind: "end" }] },
  },
};
```

Step kinds: `say` | `choice` | `command` | `goto` | `end`.
- `SayStep`: `text` (+ optional i18n `key`), `speaker?`, `expression?`, `speed?`,
  `autoAdvanceMs?`, `commands?`, `view?`, `meta?`, `voice?`.
- `ChoiceOption`: `text`, `target?`, `condition?`, `once?`, `commands?`, `meta?`.
- `CommandStep`: `commands` (+ optional `condition`/`target` conditional jump).
- `Condition`: a var key (truthy), `{ var, op, value }` (op =
  `== != > >= < <= truthy falsy`), or `(vars) => boolean` (TS-only, not JSON).
- `loadScript(raw)` validates + freezes; throws `DialogueScriptError`.

## Inline markup (`parseMarkup` / `stripMarkup`)

BBCode-ish, survives translation, nests, unknown tags dropped silently:
`[b]` `[i]` `[color=#ffcc00]`/`[color=gold]` `[wave]` `[shake]` `[pulse]`
`[rainbow]` `[speed=2]` `[pause=400]` (zero-width ms). `\[` escapes a literal
bracket. NOT available: glossary `[term]`/`[gloss]` markup is TEMPORARILY
removed (cut from the first release; planned to return with the presentation-
platform rework — do NOT generate code against it); ruby/furigana markup was
removed permanently. Unknown tags drop silently, so scripts containing either
still parse as plain text.

## Commands — rules in, consequences out

Runner owns built-in `set` (writes branching `vars`). Every other command
surfaces to the host via `onCommand(cmd, ctx)` **and** `DialogueCommandEvent`.
`ctx.mode` is `"play" | "skip"`. A `say` line's commands fire by timing
`at: "show" | "afterReveal" | "advance"` (default `show`). `blocking: true` +
an async handler pauses the conversation until it resolves (cinematic
sequencing). `{ type: "expression", value }` is routed to the avatar built-in.

## DialogueController (L2a Component) — host owns focus/pause

```ts
new DialogueController({
  ...createBoxDialogue(theme),    // DialogueBundle: { chrome, text, choices, avatar?, skipMultiplier? }
  avatar,                          // optional AvatarPresenter override
  i18n,                            // optional I18nAdapter
  params: { playerName: "Ada" },   // shared {token} interpolation
  input,                           // optional InputBinding (default: KeyboardInputBinding)
  onCommand: (cmd, ctx) => {},     // fires in addition to the event
  onEnded: () => {},
});
```

Methods: `play(script, params?)`, `isActive()`, `stop()`, `skip()`,
`setAutoAdvance(ms | null)`, `preview(nodeId): PreviewedLine[]`. It is multi-instance friendly — several
ambient conversations can run at once; "which is interactive" and "does the world
pause" are the game's policy (no global singleton).

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
fonts, `layerFrame/layerText`, `skipMultiplier?`. `defaultTheme()` returns a
fresh zero-asset instance — spread to tweak:
`{ ...defaultTheme(), textColor: 0xff0000 }`. Known limitation: the `portrait?`
and `textured?` theme fields exist but are NOT consumed by any factory yet — see
below for textured.

- **Default**: Graphics chrome + canvas text (`fontFamily`). Zero assets.
- **Bitmap fonts** (opt-in): set `bitmapFont` (+ `bitmapFontBold/Italic/BoldItalic`
  baked via `installBitmapFont` variant atlases) for a crisp pixel atlas.
- **Textured nine-slice** (opt-in, MANUAL): `TexturedChrome` / `TexturedBubble`
  are exported from `./presenters` (via `@yagejs/renderer`'s `createNineSlice`
  primitive — no direct pixi or `@yagejs/ui` dependency; `TextureInput` = string
  key or Texture). NO factory reads `theme.textured` — construct the chrome
  yourself and pass it as `bundle.chrome`:
  `{ ...createBoxDialogue(theme), chrome: new TexturedChrome(cfg) }`. Caveat:
  `TexturedBubble` is fixed-size (no content sizing yet).

## Experimental radial choice presenter

`RadialChoicePresenter` (+ `RadialChoiceConfig`) is exported from `./presenters`
as **`@experimental`**. A Mass-Effect-style wheel; not in any default factory
bundle, unpolished, geometry/API may change. Opt-in only.

## Save / load — DEFERRED to v1.1

Mid-dialogue save/restore is NOT supported yet: no snapshot/restore exists,
`@yagejs/save` is NOT a dependency, and the runner's cursor getters
(`getVars()`, `getNodeId()`, `getStepIndex()`, `getChosenOnce()`) are NOT
reachable through `DialogueController`/`DialogueSession` today — do not try to
capture a conversation cursor. Save outside conversations (or replay the script)
until v1.1 adds the seam.
