/**
 * @yagejs-addons/dialogue — a walkable town that drives the game-state model.
 *
 * Zero bundled ART assets: the town, the player, and the NPCs are all Graphics;
 * the dialogue presenters are `defaultDialogueTheme()` (Graphics chrome + canvas text).
 * The one bundled asset is Sage's voice-over — real synthesized speech under
 * `public/assets/voice/` (see the voice channel below). The level is wider than
 * the canvas, so a **follow camera** scrolls as you walk.
 *
 * The interactive controller installs a `VariableStorage` ONCE, then every NPC's
 * `play(script)` is content-only and shares it:
 *
 *   • `storage`   — `compose(cells({ gold }), MemoryVariableStorage())`. `gold`
 *                   is a two-way `cells` accessor into the game's purse; declared
 *                   flags/counters (`paid`, `opened`, `timesTalked`) live in the
 *                   in-memory store and **persist across conversations**.
 *   • `functions` — `has_item("rusty-key")` (argument-capable reads for gates).
 *   • `commands`  — `give-gold` / `give-item` / `take-item` / `open-gate` (the
 *                   game decides what they do; rules-in / consequences-out).
 *
 * Walk up to an NPC and press F:
 *   • Captain Vow (box) — the box presenter's per-line layout: a `meta.position:
 *                         top` alert moves the frame + text to the top, a
 *                         line-driven **in-box avatar** (`meta.portrait`/`side`)
 *                         reflows the body text around her portrait, and a
 *                         six-option briefing GROWS the frame to fit the menu.
 *   • Mira (box)        — markup + **reveal-driven events**: a per-glyph
 *                         typewriter click (`onRevealTick`, whitespace-filtered),
 *                         positional `[sfx=…/]` cues and a `[screenShake/]` marker
 *                         (`DialogueRevealMarkerEvent` — the host plays a tone /
 *                         shakes the camera; the addon name-matches nothing), and
 *                         the effect+hold idiom `[sfx=chime/][pause=0.5/]` (fire,
 *                         then hold while it plays — source order is the timing).
 *                         Plus a **cycling counter** (`timesTalked` persists, so
 *                         she greets you differently each visit).
 *   • Quartermaster     — pays a one-time stipend via `give-gold`, gated on a
 *                         declared `paid` flag (a second visit knows you're paid).
 *   • Vex the trader    — sells the rusty key for 50g: the buy option appears only
 *                         when an **expression condition** (`gold >= 50 and not
 *                         has_item("rusty-key")`) holds, then `set gold = gold - 50`
 *                         writes through the cell and `give-item` hands you the key.
 *   • Rook              — a **timed choice** (a recipe, not an engine feature):
 *                         decide within 5s or the host commits a default ("Freeze
 *                         up"). A `choice-timer` command arms a host-owned countdown
 *                         (ChoiceTimer) on the GAME clock — so P pauses it too.
 *   • Gate Guard        — opens the gate only with the key; the unlock option is
 *                         shown **disabled** ("needs the rusty key") until you hold
 *                         one. On unlock it spends the key (`take-item`) and runs
 *                         `open-gate` (a world consequence that extends the
 *                         walkable area).
 *   • Sage (bubble)     — no `view` hint: the default route floats him in a
 *                         bubble because he has a registered actor (speaker-aware).
 *                         He's also the **voiced** NPC: each line carries a `voice`
 *                         id played as a real clip over `@yagejs/audio`, gating
 *                         auto-advance until the voice finishes.
 *   • Ann & Bert        — stand near them to **eavesdrop** an ambient gossip loop
 *                         (a second controller with `input: null` — it never
 *                         takes device input; the game drives it).
 *   • Pip the Locksmith — the one NPC authored in the **compact DSL** (not YAML):
 *                         a conditional jump (`-> regreet if: pip_seen`) re-greets
 *                         a returning customer, with a `declare`d flag, line-driven
 *                         `#portrait:`/`#side:` avatars, and `set` / `do` against
 *                         the same shared storage.
 *
 * The HUD shows your live gold + items. Hold **J** to fast-forward, hold **X** to
 * skip, press **V** to toggle auto-advance; the pointer works too. The three
 * lifecycle levers ride two keys: **P** pauses (the conversation freezes
 * intact behind a dim overlay — `setPaused`) and **H** hides the dialogue UI
 * mid-line, restoring it at the same reveal point (`setHidden`). The
 * **Font** button swaps every presenter to a baked bitmap font and back.
 *
 * Two **registered channels** ride alongside the built-in presenter trio — the
 * open-ended extensibility seam, each added with zero addon change via the
 * controller's `channels` option:
 *   • a built-in `createVoiceChannel` voice-over — reads Sage's per-line `voice`
 *     id and plays it over `@yagejs/audio` (a "voice" channel). It **gates
 *     auto-advance until the clip ends** (so with **V** on, Sage waits for his own
 *     voice — `max(clipEnd, revealEnd)`), **P** pauses the clip with the
 *     conversation, and the gate releases via `@yagejs/audio`'s `onEnd` (no
 *     polling). With `onSkip: "ring"`, completing the typewriter does NOT cut the
 *     voice — it's stopped only when you move to the next line.
 *   • a custom `TranscriptChannel` — a `Mountable` observer implementing only
 *     `present`, logging each line the moment it appears (no waiting for the
 *     typewriter) to a small semi-opaque HUD panel; a channel that gates nothing.
 *
 * Eight scripts live in plain **YAML data files** under `./scripts/` (a designer
 * edits them without touching code), imported via Vite's `?raw` suffix and parsed
 * by `loadYaml` (the `/yaml` subpath). Conditions and `set` values are plain string
 * expressions (`"gold >= 50 and not has_item('rusty-key')"`, `"gold - 50"`) instead
 * of hand-built trees — `loadYaml` runs them through the same string→expression
 * parser the JSON loader uses. Pip's script (`./scripts/locksmith.dlg`) is the
 * same idea in the **compact DSL**: `loadCompact` (the root entry, no `yaml` dep)
 * over a terse, line-oriented format that compiles to the identical frozen IR.
 *
 * Export split: runner / controller / events / input / the storage kit come from
 * the pixi-free root entry; YAML authoring from `/yaml`; presenters + theme from
 * `/presenters`.
 */

import { Engine } from "@yagejs/core";
import { RendererPlugin, installBitmapFont } from "@yagejs/renderer";
import { InputPlugin } from "@yagejs/input";
import { AudioPlugin } from "@yagejs/audio";
import { defaultDialogueTheme, type DialogueTheme } from "@yagejs-addons/dialogue/presenters";
import { installDebugFromUrl, setupGameContainer } from "../shared/bootstrap.js";
import { WIDTH, HEIGHT } from "./constants.js";
import { RoomScene } from "./scene.js";
import { THEME_PRESETS } from "./theme.js";
import "./styles.css";

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        interact: ["Enter", "Space", "KeyF"],
        "move-up": ["ArrowUp", "KeyW"],
        "move-down": ["ArrowDown", "KeyS"],
        "move-left": ["ArrowLeft", "KeyA"],
        "move-right": ["ArrowRight", "KeyD"],
        attack: ["KeyJ"], // hold to fast-forward (FULL_DIALOGUE_ACTIONS.speed)
        skip: ["KeyX"], // hold to skip (FULL_DIALOGUE_ACTIONS.skip)
        auto: ["KeyV"], // toggle auto-advance
        pause: ["KeyP"], // setPaused — freeze the conversation + world
        hide: ["KeyH"], // setHidden — hide the dialogue UI mid-line
      },
      preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    }),
  );
  // A dedicated "voice" channel for Sage's clips (own volume, mute, pause).
  engine.use(new AudioPlugin({ channels: { voice: { volume: 1 } } }));
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new RoomScene());
  wireControls(engine);
}

/**
 * The "Font" + "Theme" buttons under the canvas. Each rebuilds the town with a
 * scene swap (not a live restyle: presenters take their font/theme at
 * construction, and the game state resets with the fresh scene). Font bakes the
 * bitmap atlas on first use (32px glyphs rendered at the bitmap theme's 14px —
 * exercising the measurement scaling) and layers it on the current theme; Theme
 * cycles {@link THEME_PRESETS} — default → warm recolour → textured nine-slice.
 */
function wireControls(engine: Engine): void {
  let bitmap = false;
  let fontName: string | undefined;
  let themeIndex = 0;
  let themeBuild: () => DialogueTheme = THEME_PRESETS[0]?.build ?? defaultDialogueTheme;
  const rebuild = (): Promise<void> =>
    engine.scenes.replace(new RoomScene(themeBuild, bitmap ? fontName : undefined));

  const fontBtn = document.getElementById("font-toggle");
  if (fontBtn instanceof HTMLButtonElement) {
    fontBtn.addEventListener("click", () => {
      void (async () => {
        fontBtn.disabled = true;
        bitmap = !bitmap;
        fontName ??= await installBitmapFont("/assets/Kenney Future.ttf", {
          name: "Kenney Bitmap",
        });
        await rebuild();
        fontBtn.textContent = bitmap ? "Font: Bitmap" : "Font: Canvas";
        fontBtn.disabled = false;
      })();
    });
  }

  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn instanceof HTMLButtonElement) {
    themeBtn.addEventListener("click", () => {
      void (async () => {
        themeBtn.disabled = true;
        themeIndex = (themeIndex + 1) % THEME_PRESETS.length;
        const preset = THEME_PRESETS[themeIndex];
        if (preset) {
          themeBuild = preset.build;
          await rebuild();
          themeBtn.textContent = `Theme: ${preset.label}`;
        }
        themeBtn.disabled = false;
      })();
    });
  }
}

main().catch(console.error);
