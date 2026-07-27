/**
 * DialogueController — the thin YAGE host. It owns no dialogue logic; it just:
 *
 *   • mounts the presenters onto the scene,
 *   • builds a headless {@link DialogueSession} over them,
 *   • forwards the session's observation callbacks to engine events,
 *   • attaches an {@link InputBinding} (keyboard by default) and pumps it,
 *   • pumps `session.update(dt)` each frame.
 *
 * All the sequencing, reveal-gating, choice book-keeping, and i18n live in the
 * session (engine-agnostic). The presenter bundle usually comes from a factory
 * (`createBoxDialogue(theme)`), spread-and-overridden as needed:
 *
 *   host.add(new DialogueController({ ...createBoxDialogue(theme), avatar, storage }));
 */

import { Component, LoggerKey, isDev, type Logger } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import {
  DialogueSession,
  type CommandHandler,
  type DialogueExtraChannel,
  type DialogueFunction,
  type DialogueHandle,
  type DialoguePlayOptions,
  type DialogueScript,
  type I18nAdapter,
  type PreviewedLine,
  type VariableStorage,
  type VarsOf,
} from "./core/index.js";
import type {
  ChromePresenter,
  ChoicePresenter,
  Mountable,
  TextPresenter,
} from "./chrome/DialogueUiAdapter.js";
import type { AvatarPresenter } from "./avatar/AvatarPresenter.js";
import { dialogueControls, type InputBinding } from "./input/index.js";
import {
  DialogueAutoAdvanceEvent,
  DialogueChoiceMadeEvent,
  DialogueChoiceShownEvent,
  DialogueCommandEvent,
  DialogueEndedEvent,
  DialogueLineEvent,
  DialogueRevealCompletedEvent,
  DialogueRevealMarkerEvent,
  DialogueSelectionChangedEvent,
  DialogueSkipUsedEvent,
  DialogueStartedEvent,
} from "./events.js";

/** The presenter trio a factory assembles (see `createBoxDialogue`).
 *  Optional fields are `T | undefined` so factories and games can assign
 *  possibly-undefined theme values directly (exactOptionalPropertyTypes). */
export interface DialogueBundle {
  readonly chrome: ChromePresenter;
  readonly text: TextPresenter;
  readonly choices: ChoicePresenter;
  readonly avatar?: AvatarPresenter | undefined;
  /** Hold-to-fast-forward multiplier. Default 4. */
  readonly skipMultiplier?: number | undefined;
}

export interface DialogueControllerOptions<
  TStorage extends VariableStorage = VariableStorage,
> extends DialogueBundle {
  readonly i18n?: I18nAdapter | undefined;
  /**
   * The variable storage installed for every `play()`. Persists across
   * plays. Omit for a zero-config `MemoryVariableStorage`; supply your own (or
   * `compose(cells(...), new MemoryVariableStorage())`) to bridge game state. A
   * per-`play()` `overrides.storage` replaces it for that conversation.
   */
  readonly storage?: TStorage | undefined;
  /** Argument-capable read functions (`has_item("key")`) shared across plays. */
  readonly functions?: Readonly<Record<string, DialogueFunction>> | undefined;
  /** Command handlers (`type` → handler) shared across plays; per-`play()`
   *  `overrides.commands` merge on top (call site wins). */
  readonly commands?: Readonly<Record<string, CommandHandler>> | undefined;
  /** Catch-all for command types with no explicit handler. */
  readonly fallbackCommand?: CommandHandler | undefined;
  /**
   * Device → session binding. Three modes:
   * - omit: the zero-config default, {@link dialogueControls} wired to this
   *   controller's own choices presenter — keyboard/gamepad over the
   *   `move-up`/`move-down`/`interact`/`attack`/`skip` action names PLUS
   *   mouse/touch (tap to advance, tap/hover choice rows). Construct
   *   `dialogueControls(choices, { actions, skipHold })` yourself only to
   *   rename the actions or add a hold-to-skip.
   * - an {@link InputBinding}: your own device mapping.
   * - `null`: NO device input — the ambient/cutscene/host-driven mode, where
   *   the host calls {@link DialogueController.advance}/
   *   {@link DialogueController.moveSelection}/{@link DialogueController.choose}/
   *   {@link DialogueController.skip} itself.
   * Unmapped action names silently never fire; a full mismatch logs a
   * dev-mode warning.
   */
  readonly input?: InputBinding | null | undefined;
  /**
   * Extra channels registered on the session at mount (Voice / Shop /
   * CameraEffects / History) — the open-ended companion to the presenter trio.
   * Each is wired via {@link DialogueController.addChannel}; one that also
   * implements {@link Mountable} (it needs the scene) is mounted in `onAdd` and
   * disposed in `onDestroy`. A factory bundle can pre-wire e.g. a voice channel
   * here; a game can also add one live with {@link DialogueController.addChannel}.
   */
  readonly channels?: readonly DialogueExtraChannel[] | undefined;
  /**
   * Per-grapheme typewriter tick — a direct callback (NOT an entity event; it
   * fires hundreds of times per line). `index` is the raw grapheme index revealed
   * (whitespace included — filter if you only want a blip on visible glyphs).
   * Wire a typewriter SFX here. Inline `[name k=v/]` markers, by contrast, come
   * through {@link DialogueRevealMarkerEvent} on the entity bus.
   */
  readonly onRevealTick?: ((index: number) => void) | undefined;
  /** Called once when a conversation ends (in addition to the scene event). */
  readonly onEnded?: () => void;
}

export class DialogueController<
  TStorage extends VariableStorage = VariableStorage,
> extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly binding: InputBinding | undefined;
  private session!: DialogueSession;
  /** Captured at onAdd (the scene is gone by the time a stale play() arrives). */
  private logger: Logger | undefined;
  /** Set by onDestroy — the presenters are disposed, so play() must refuse. */
  private destroyed = false;
  /** Input focus. When false, `update()` keeps pumping the session (an
   *  ambient conversation stays alive) but the binding is NOT polled, so this
   *  instance doesn't consume device input. NOT `Component.enabled` (which would
   *  also freeze the session). */
  private inputEnabled = true;
  /** Pause. Mirrors the session's pause so the binding poll is also gated
   *  while frozen — a paused conversation neither updates nor consumes input.
   *  Also the source of truth re-applied to the session in `onAdd` when a host
   *  set it before the component was added (the session didn't exist yet). */
  private paused = false;
  /** Hidden. Mirrors the session's hide so a `setHidden` issued before the
   *  component was added isn't lost — it's re-applied once the session exists. */
  private hidden = false;
  /** Whether the current input binding owns live device resources. */
  private bindingActive = false;
  /** Disposers for every registered extra channel (ctor `channels` + live
   *  `addChannel`). `onDestroy` runs them all — each idempotent — to unregister
   *  and dispose (unmounting the Mountable ones). */
  private readonly channelDisposers = new Set<() => void>();

  constructor(private readonly opts: DialogueControllerOptions<TStorage>) {
    super();
    // Zero-config: keyboard/gamepad + mouse/touch, with pointer choice
    // hit-testing wired to the choices presenter this controller already
    // holds. `input: null` = no device input at all (host-driven mode).
    this.binding =
      opts.input === null
        ? undefined
        : (opts.input ?? dialogueControls(opts.choices));
  }

  onAdd(): void {
    this.logger = this.context.tryResolve(LoggerKey);
    // One diagnostics seam shared by the session's onError AND presenter-level
    // warnings (e.g. a missing actor) — both land on the engine Logger, never
    // console.warn.
    const warn = (message: string): void =>
      this.logger?.warn("dialogue", message);

    this.opts.chrome.mount(this.scene);
    this.opts.choices.mount(this.scene);
    this.opts.avatar?.mount(this.scene);
    this.opts.text.mount(this.scene);

    // Inject the diagnostics sink into any presenter that reports through it.
    this.opts.chrome.setDiagnostics?.(warn);
    this.opts.text.setDiagnostics?.(warn);
    this.opts.choices.setDiagnostics?.(warn);

    this.session = new DialogueSession(
      {
        text: this.opts.text,
        choices: this.opts.choices,
        avatar: this.opts.avatar,
        chrome: this.opts.chrome,
      },
      {
        i18n: this.opts.i18n,
        skipMultiplier: this.opts.skipMultiplier,
        // Controller-installed environment — persists across plays.
        storage: this.opts.storage,
        functions: this.opts.functions,
        commands: this.opts.commands,
        fallbackCommand: this.opts.fallbackCommand,
        onStarted: (e) => this.entity.emit(DialogueStartedEvent, e),
        onLine: (e) => this.entity.emit(DialogueLineEvent, e),
        onChoiceShown: (e) =>
          this.entity.emit(DialogueChoiceShownEvent, { options: e.options }),
        onChoiceMade: (e) => this.entity.emit(DialogueChoiceMadeEvent, e),
        // Observation only — the `commands` map does the work; this mirrors
        // every non-built-in command onto the scene event bus.
        onCommand: (command, ctx) =>
          this.entity.emit(DialogueCommandEvent, { command, mode: ctx.mode }),
        // Route non-fatal runtime diagnostics (e.g. a `set` to a read-only cell)
        // through the engine logger rather than crashing or silently dropping.
        onError: (message) => warn(message),
        onEnded: (e) => {
          this.entity.emit(DialogueEndedEvent, e);
          this.opts.onEnded?.();
        },
        // Observation events — the controller is the one canonical path that
        // turns the session's callbacks into entity→scene events (no matching
        // controller callback options).
        onRevealCompleted: (e) =>
          this.entity.emit(DialogueRevealCompletedEvent, e),
        onSelectionChanged: (e) =>
          this.entity.emit(DialogueSelectionChangedEvent, e),
        onSkipUsed: (e) => this.entity.emit(DialogueSkipUsedEvent, e),
        onAutoAdvance: (e) => this.entity.emit(DialogueAutoAdvanceEvent, e),
        // Inline markers fan to an entity event; per-grapheme ticks stay a direct
        // callback (forwarded verbatim — undefined when the host wires none).
        onRevealMarker: (marker, viaSkip) =>
          this.entity.emit(DialogueRevealMarkerEvent, { marker, viaSkip }),
        onRevealTick: this.opts.onRevealTick,
      },
    );
    this.warnIfActionsUnmapped(warn);

    // `onEnable` runs after `onAdd`. Keep the session dormant until then so a
    // component added with `enabled = false` never paints or claims input.
    this.session.setPaused(true);
    this.session.setHidden(true);

    // Register any pre-wired extra channels (a factory bundle can include a
    // voice channel). Same path as a live addChannel: mount the scene-needing
    // ones, hand each to the session, and track its disposer for onDestroy.
    for (const ch of this.opts.channels ?? []) this.addChannel(ch);
  }

  onEnable(): void {
    this.session.setPaused(this.paused);
    this.session.setHidden(this.hidden);
    this.syncBinding();
  }

  onDisable(): void {
    this.deactivateBinding();
    this.session?.setPaused(true);
    this.session?.setHidden(true);
  }

  onDestroy(): void {
    this.destroyed = true;
    // Stop first: bumps the session generation so an in-flight blocking-command
    // continuation bails instead of presenting onto presenters we're about to
    // dispose; also clears visuals (and fans clear() to the extras) while valid.
    this.session?.stop();
    // Tear down every registered extra channel — unregister + dispose, which
    // unmounts the Mountable ones. A snapshot copy: each disposer mutates the set.
    for (const dispose of [...this.channelDisposers]) dispose();
    this.deactivateBinding();
    this.opts.text.dispose();
    this.opts.choices.dispose();
    this.opts.chrome.dispose();
    this.opts.avatar?.dispose();
  }

  /**
   * Begin a conversation. `play(script)` is **content-only** — storage,
   * functions, and commands are installed on the controller. `overrides` layers
   * per-conversation specifics on top (a scoped `storage`, extra
   * `functions`/`commands`). Returns a {@link DialogueHandle} for live `setVar` /
   * `getVars`, or `undefined` if the controller was removed.
   */
  play<S extends DialogueScript>(
    script: S,
    overrides?: DialoguePlayOptions,
  ): DialogueHandle<VarsOf<S>> | undefined {
    // A stale reference calling play() after the component was removed (e.g. a
    // game keeping the controller in an interact closure past
    // `DialogueEndedEvent → host.destroy()`) would run a new conversation into
    // disposed presenters: orphan entities, frozen reveal, no error. Refuse.
    if (this.destroyed) {
      this.logger?.warn(
        "dialogue",
        "DialogueController.play() ignored: the component has been removed/destroyed.",
        { scriptId: script.id },
      );
      return undefined;
    }
    if (!this.session) {
      throw new Error(
        "DialogueController.play() called before the component was added to an entity (onAdd has not run yet).",
      );
    }
    if (!this.effectiveEnabled) return undefined;
    return this.session.play(script, overrides);
  }

  isActive(): boolean {
    return this.session?.isActive() ?? false;
  }

  /** Abandon the current conversation and reset to idle. */
  stop(): void {
    this.session?.stop();
  }

  /**
   * Register an extra channel live — Voice / Shop / CameraEffects / History.
   * Mounts it if it needs the scene ({@link Mountable}), hands it to the session
   * (where it joins the cross-cutting stream and can gate auto-advance), and
   * returns a disposer that unregisters + disposes it. The `channels` ctor option
   * registers a bundle the same way at mount. Returns a no-op disposer if the
   * controller was destroyed; **throws** if called before the component is added
   * to an entity (use the `channels` ctor option to pre-wire a channel) — mirrors
   * {@link play}.
   */
  addChannel(ch: DialogueExtraChannel): () => void {
    if (this.destroyed) {
      this.logger?.warn(
        "dialogue",
        "DialogueController.addChannel() ignored: the component has been removed/destroyed.",
      );
      return () => {};
    }
    // Before onAdd there is no session/scene to mount onto — and no Logger yet
    // (it's captured in onAdd), so a warn here couldn't surface. Throw loudly like
    // play() does, and point at the `channels` ctor option (the pre-onAdd path).
    if (!this.session) {
      throw new Error(
        "DialogueController.addChannel() called before the component was added to an entity (onAdd has not run yet). Use the `channels` constructor option to pre-wire a channel.",
      );
    }
    if (isMountable(ch)) {
      try {
        ch.mount(this.scene);
      } catch (error) {
        this.logger?.warn(
          "dialogue",
          `extra channel mount() failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const unregister = this.session.addChannel(ch);
    const dispose = (): void => {
      if (!this.channelDisposers.delete(dispose)) return; // idempotent
      unregister(); // splices the session's extras + calls ch.dispose?.()
    };
    this.channelDisposers.add(dispose);
    return dispose;
  }

  /** Fast-forward the current section to the next choice or the end. */
  skip(): void {
    this.session?.skip();
  }

  /**
   * Auto-advance lines this many seconds after they finish revealing, or `null`
   * to disable (manual advance). A per-line `autoAdvance` still overrides this.
   * Toggle it live for a VN-style "auto" control.
   */
  setAutoAdvance(seconds: number | null): void {
    this.session?.setAutoAdvance(seconds);
  }

  /**
   * Hide or show the whole dialogue UI without ending the conversation —
   * for a cutscene takeover (`setHidden(true)` while the camera pans, then
   * `setHidden(false)` to restore the exact line + caret). Purely visual; the
   * conversation keeps its state. **Persistent**: it survives `stop()`/`play()`,
   * so a host that hides and forgets to unhide stays hidden.
   */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.session?.setHidden(hidden || !this.effectiveEnabled);
  }

  /**
   * Freeze or resume the conversation — a pause menu. While paused the
   * reveal, auto-advance, caret blink, and avatar anim all halt, input is inert,
   * and no state is lost (an in-flight blocking command keeps running). Also
   * gates this controller's input binding so a frozen conversation consumes no
   * device input. Does NOT block host-driven `handle.setVar` / storage writes.
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.session?.setPaused(paused || !this.effectiveEnabled);
    this.syncBinding();
  }

  /**
   * Set whether this controller consumes device input — the focus seam for
   * the multi-instance story. `setInputEnabled(false)` keeps the conversation
   * fully alive (it still updates, reveals, auto-advances) but stops polling its
   * binding, so an ambient conversation doesn't steal the advance key. Switch
   * focus between two conversations with `a.setInputEnabled(true);
   * b.setInputEnabled(false)`. (YAGE input is non-consuming, so two *enabled*
   * controllers both advance on one press — focus is the game's policy.)
   * A no-op under `input: null` — there is no binding to gate.
   */
  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    this.syncBinding();
  }

  /**
   * Primary action, host-driven (the input-agnostic seam): while saying,
   * reveal-all if still typing else advance to the next line; while choosing,
   * confirm the highlighted option. Lets a host (cutscene script, custom input,
   * or a test) drive the conversation without synthesising device input — the
   * same call the default {@link InputBinding} makes.
   */
  advance(): void {
    this.session?.advance();
  }

  /** Move the choice cursor by `delta` (wraps). No-op outside a choice. */
  moveSelection(delta: number): void {
    this.session?.moveSelection(delta);
  }

  /** Commit a choice by its original option index. No-op outside a choice. */
  choose(optionIndex: number): void {
    this.session?.choose(optionIndex);
  }

  /** True while a choice is being presented. */
  isChoosing(): boolean {
    return this.session?.isChoosing() ?? false;
  }

  /** Side-effect-free lookahead of the lines a node would show. */
  preview(nodeId: string): PreviewedLine[] {
    return this.session?.preview(nodeId) ?? [];
  }

  update(dt: number): void {
    // The session keeps pumping even when this instance lacks input focus (an
    // ambient conversation stays alive and animating); it no-ops internally when
    // paused. The binding is polled only when focused AND not paused, so a
    // backgrounded or frozen conversation consumes no device input.
    this.session?.update(dt);
    if (this.bindingActive) this.binding?.poll();
  }

  private syncBinding(): void {
    if (
      !this.binding ||
      !this.session ||
      !this.effectiveEnabled ||
      !this.inputEnabled ||
      this.paused
    ) {
      this.deactivateBinding();
      return;
    }
    if (this.bindingActive) return;
    this.binding.bind(this.input, this.session);
    this.bindingActive = true;
  }

  private deactivateBinding(): void {
    if (!this.bindingActive) return;
    this.binding?.dispose?.();
    this.bindingActive = false;
  }

  /**
   * Warn (dev only) when NONE of the binding's polled action names exist in the
   * live `InputManager` map — the silent-no-op trap: the default action names
   * (kebab-case `move-up`/`interact`/…) don't match a game's custom map, so
   * keyboard choice nav does nothing with no error anywhere. A partial mismatch
   * is intentional (a game may bind only a subset), so only a *total* miss warns.
   */
  private warnIfActionsUnmapped(warn: (message: string) => void): void {
    if (!isDev()) return;
    const names = this.binding?.actionNames?.() ?? [];
    if (names.length === 0) return; // pointer-only or no binding — nothing to validate
    const mapped = new Set(this.input.getActionNames());
    if (names.some((a) => mapped.has(a))) return; // at least one is wired
    warn(
      `dialogue input binding references action names absent from the InputManager map ` +
        `(${names.join(", ")}); keyboard/gamepad controls will do nothing. Pass an ` +
        `\`input\` binding wired to your game's action names.`,
    );
  }
}

/** Whether an extra channel also needs the scene — it implements {@link Mountable}
 *  (a `mount(scene)`), beyond the `DialogueExtraChannel` hooks. A plain observer
 *  (Voice / Shop) has no `mount`. */
function isMountable(
  ch: DialogueExtraChannel,
): ch is DialogueExtraChannel & Mountable {
  return typeof (ch as { mount?: unknown }).mount === "function";
}
