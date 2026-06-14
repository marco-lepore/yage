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

import { Component, LoggerKey, type Logger } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import {
  DialogueSession,
  type CommandHandler,
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
  TextPresenter,
} from "./chrome/DialogueUiAdapter.js";
import type { AvatarPresenter } from "./avatar/AvatarPresenter.js";
import { KeyboardInputBinding, type InputBinding } from "./input/index.js";
import {
  DialogueChoiceMadeEvent,
  DialogueChoiceShownEvent,
  DialogueCommandEvent,
  DialogueEndedEvent,
  DialogueLineEvent,
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

export interface DialogueControllerOptions<TStorage extends VariableStorage = VariableStorage>
  extends DialogueBundle {
  readonly i18n?: I18nAdapter | undefined;
  /**
   * The variable storage installed for every `play()` (D1). Persists across
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
  /** Device → session binding. Omit for the default keyboard binding. */
  readonly input?: InputBinding;
  /** Called once when a conversation ends (in addition to the scene event). */
  readonly onEnded?: () => void;
}

export class DialogueController<
  TStorage extends VariableStorage = VariableStorage,
> extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly binding: InputBinding;
  private session!: DialogueSession;
  /** Captured at onAdd (the scene is gone by the time a stale play() arrives). */
  private logger: Logger | undefined;
  /** Set by onDestroy — the presenters are disposed, so play() must refuse. */
  private destroyed = false;

  constructor(private readonly opts: DialogueControllerOptions<TStorage>) {
    super();
    this.binding = opts.input ?? new KeyboardInputBinding();
  }

  onAdd(): void {
    this.logger = this.context.tryResolve(LoggerKey);
    this.opts.chrome.mount(this.scene);
    this.opts.choices.mount(this.scene);
    this.opts.avatar?.mount(this.scene);
    this.opts.text.mount(this.scene);

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
        // Controller-installed environment (D1) — persists across plays.
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
        onEnded: (e) => {
          this.entity.emit(DialogueEndedEvent, e);
          this.opts.onEnded?.();
        },
      },
    );
    this.binding.bind(this.input, this.session);
  }

  onDestroy(): void {
    this.destroyed = true;
    // Stop first: bumps the session generation so an in-flight blocking-command
    // continuation bails instead of presenting onto presenters we're about to
    // dispose; also clears visuals while they're still valid.
    this.session?.stop();
    this.binding.dispose?.();
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
    return this.session.play(script, overrides);
  }

  isActive(): boolean {
    return this.session?.isActive() ?? false;
  }

  /** Abandon the current conversation and reset to idle. */
  stop(): void {
    this.session?.stop();
  }

  /** Fast-forward the current section to the next choice or the end. */
  skip(): void {
    this.session?.skip();
  }

  /**
   * Auto-advance lines after they finish revealing (`ms`), or `null` to disable
   * (manual advance). A per-line `autoAdvanceMs` still overrides this. Toggle it
   * live for a VN-style "auto" control.
   */
  setAutoAdvance(ms: number | null): void {
    this.session?.setAutoAdvance(ms);
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
    this.session?.update(dt);
    this.binding.poll();
  }
}
