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
 *   host.add(new DialogueController({ ...createBoxDialogue(theme), avatar, params }));
 */

import { Component } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import {
  DialogueSession,
  type Command,
  type CommandContext,
  type DialogueScript,
  type I18nAdapter,
  type PreviewedLine,
} from "./core/index.js";
import type {
  ChromePresenter,
  ChoicePresenter,
} from "./chrome/DialogueUiAdapter.js";
import type { TextPresenter } from "./render/DialogueTextView.js";
import type { AvatarPresenter } from "./avatar/AvatarPresenter.js";
import { KeyboardInputBinding, type InputBinding } from "./input/index.js";
import {
  DialogueChoiceMadeEvent,
  DialogueChoiceShownEvent,
  DialogueCommandEvent,
  DialogueEndedEvent,
  DialogueLineEvent,
  DialogueStartedEvent,
  DialogueTermActivatedEvent,
} from "./events.js";

/** The presenter trio a factory assembles (see `createBoxDialogue`). */
export interface DialogueBundle {
  readonly chrome: ChromePresenter;
  readonly text: TextPresenter;
  readonly choices: ChoicePresenter;
  readonly avatar?: AvatarPresenter;
  /** Hold-to-fast-forward multiplier. Default 4. */
  readonly skipMultiplier?: number;
}

export interface DialogueControllerOptions extends DialogueBundle {
  readonly i18n?: I18nAdapter;
  /** Interpolation context shared by every line/choice/name (`{playerName}` …). */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Device → session binding. Omit for the default keyboard binding. */
  readonly input?: InputBinding;
  /**
   * Game command handler. Fires in addition to {@link DialogueCommandEvent}.
   * Return a promise from a `blocking` command to pause the conversation until
   * it resolves (cinematic sequencing). `ctx.mode` is "play" or "skip".
   */
  readonly onCommand?: (
    command: Command,
    ctx: CommandContext,
  ) => void | Promise<void>;
  /** Called once when a conversation ends (in addition to the scene event). */
  readonly onEnded?: () => void;
  /**
   * Called when a `[term=…]` glossary span is activated by the pointer (in
   * addition to {@link DialogueTermActivatedEvent}). The system only reports the
   * opaque term `id` and the activating pointer's screen position — the game
   * maps the id to a definition and renders any tooltip. `kind` is "hover" while
   * the pointer rests over the span and "tap" on a primary click. Requires the
   * text presenter to implement the `termAtPoint` seam (the default views do).
   */
  readonly onTermActivate?: (e: {
    id: string;
    screen: { x: number; y: number };
    kind: "hover" | "tap";
  }) => void;
}

export class DialogueController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly binding: InputBinding;
  private session!: DialogueSession;

  /** Edge-detect for term hover (fire once per term, not every frame). */
  private hoveredTerm?: string | undefined;
  /** A primary-button press happened since the last term poll (consumed in update). */
  private termClicked = false;
  private unsubPointer?: (() => void) | undefined;

  constructor(private readonly opts: DialogueControllerOptions) {
    super();
    this.binding = opts.input ?? new KeyboardInputBinding();
  }

  onAdd(): void {
    this.opts.chrome.mount(this.scene);
    this.opts.choices.mount(this.scene);
    this.opts.avatar?.mount(this.scene);
    this.opts.text.mount(this.scene);

    // Glossary-term pointer seam: a tap edge is captured here; hover is sampled
    // each frame in `pollTerms`. Mirrors PointerInputBinding's click latch.
    this.unsubPointer = this.input.onPointerDown((info) => {
      if (info.button === 0) this.termClicked = true;
    });

    this.session = new DialogueSession(
      {
        text: this.opts.text,
        choices: this.opts.choices,
        // Only include `avatar` when present — `exactOptionalPropertyTypes`
        // rejects an explicit `undefined` for the optional channel.
        ...(this.opts.avatar ? { avatar: this.opts.avatar } : {}),
        chrome: this.opts.chrome,
      },
      {
        // Conditionally include the optional knobs so we never assign `undefined`
        // to a `?:`-optional option (exactOptionalPropertyTypes).
        ...(this.opts.i18n !== undefined ? { i18n: this.opts.i18n } : {}),
        ...(this.opts.params !== undefined ? { params: this.opts.params } : {}),
        ...(this.opts.skipMultiplier !== undefined
          ? { skipMultiplier: this.opts.skipMultiplier }
          : {}),
        onStarted: (e) => this.entity.emit(DialogueStartedEvent, e),
        onLine: (e) => this.entity.emit(DialogueLineEvent, e),
        onChoiceShown: (e) =>
          this.entity.emit(DialogueChoiceShownEvent, { options: e.options }),
        onChoiceMade: (e) => this.entity.emit(DialogueChoiceMadeEvent, e),
        onCommand: (command, ctx) => {
          this.entity.emit(DialogueCommandEvent, { command, mode: ctx.mode });
          return this.opts.onCommand?.(command, ctx);
        },
        onEnded: (e) => {
          this.entity.emit(DialogueEndedEvent, e);
          this.opts.onEnded?.();
        },
      },
    );
    this.binding.bind(this.input, this.session);
  }

  onDestroy(): void {
    this.unsubPointer?.();
    this.unsubPointer = undefined;
    this.binding.dispose?.();
    this.opts.text.dispose();
    this.opts.choices.dispose();
    this.opts.chrome.dispose();
    this.opts.avatar?.dispose();
  }

  /** Begin a conversation. `params` merges into the shared interpolation context. */
  play(
    script: DialogueScript,
    params?: Readonly<Record<string, unknown>>,
  ): void {
    this.session.play(script, params);
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
    this.pollTerms();
  }

  /**
   * Glossary-term pointer routing (event-only). Hit-tests the pointer against
   * the active line's `[term=…]` spans via the text presenter's `termAtPoint`
   * seam (mirroring `PointerChoiceTarget`), and emits the opaque term id + the
   * pointer's screen position on hover (once per term) and on a primary tap. The
   * game owns the tooltip; the system never renders one. No-op when the text
   * presenter doesn't expose `termAtPoint` (the seam is optional).
   */
  private pollTerms(): void {
    const text = this.opts.text;
    const clicked = this.termClicked;
    this.termClicked = false;
    if (!text.termAtPoint) {
      this.hoveredTerm = undefined;
      return;
    }
    // A term presenter declares the coordinate space its boxes live in: a
    // screen-pinned box reads screen coords, a world-anchored bubble reads world.
    const p =
      text.pointerSpace === "world"
        ? this.input.getPointerPosition()
        : this.input.getPointerScreenPosition();
    const screen = this.input.getPointerScreenPosition();
    const term = text.termAtPoint(p.x, p.y);

    // Hover: edge-trigger so the host gets one event per entered term.
    if (term !== this.hoveredTerm) {
      this.hoveredTerm = term;
      if (term !== undefined) {
        const e = {
          id: term,
          screen: { x: screen.x, y: screen.y },
          kind: "hover" as const,
        };
        this.entity.emit(DialogueTermActivatedEvent, e);
        text.onTermActivate?.(term);
        this.opts.onTermActivate?.(e);
      }
    }

    // Tap: a primary click while the pointer rests on a term commits it.
    if (clicked && term !== undefined) {
      const e = {
        id: term,
        screen: { x: screen.x, y: screen.y },
        kind: "tap" as const,
      };
      this.entity.emit(DialogueTermActivatedEvent, e);
      text.onTermActivate?.(term);
      this.opts.onTermActivate?.(e);
    }
  }
}
