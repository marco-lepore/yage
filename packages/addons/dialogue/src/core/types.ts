/**
 * Engine-agnostic dialogue model. Nothing in this folder imports `@yagejs/*`
 * — it's plain TypeScript so it can be unit-tested headless and lifted into a
 * standalone `@yagejs/dialogue` package later. Engine/UI/i18n touch points all
 * live behind adapters (see ../chrome, ../render, ../avatar, ./i18n).
 */

export type NodeId = string;
export type SpeakerId = string;

/**
 * A side effect attached to a step or a choice. The runner handles a couple of
 * built-ins (`set` mutates branching vars, `goto` jumps) and surfaces the rest
 * to the host via the command event, so the game decides what `give-item` or
 * `play-sfx` actually mean. Keep it a flat tagged record so scripts stay JSON.
 */
/**
 * When a command attached to a `say` line fires, relative to its reveal:
 * `show` (as the line appears — default), `afterReveal` (once fully typed), or
 * `advance` (as the player leaves the line). Ignored for `command`/choice
 * commands, which fire inline. Skipping fires everything at show-time.
 */
export type CommandTiming = "show" | "afterReveal" | "advance";

export interface Command {
  readonly type: string;
  /**
   * If true, a handler that returns a promise *pauses* the conversation until it
   * resolves (the runner enters its `awaiting-command` wait-state). Use for
   * cinematic sequencing — "wait for the NPC to walk off, then continue". A
   * non-blocking handler's promise is fire-and-forget.
   */
  readonly blocking?: boolean;
  /** Reveal-relative firing time for a `say`-line command. Default `show`. */
  readonly at?: CommandTiming;
  readonly [key: string]: unknown;
}

/** Whether the runner is playing normally or fast-forwarding through a skip. */
export type RunMode = "play" | "skip";

/** Context handed to every command handler. */
export interface CommandContext {
  readonly mode: RunMode;
}

/**
 * A boolean guard on a choice or step. Either a key into the runner's `vars`
 * (truthy check) or a tiny comparison `{ var, op, value }`. Predicate functions
 * are also allowed when authoring in TS (they just don't survive JSON).
 */
export type Condition =
  | string
  | { readonly var: string; readonly op: CompareOp; readonly value: unknown }
  | ((vars: VarMap) => boolean);

export type CompareOp = "==" | "!=" | ">" | ">=" | "<" | "<=" | "truthy" | "falsy";

export type VarValue = string | number | boolean | null;
export type VarMap = Record<string, VarValue>;

/** A single line of dialogue spoken by an optional speaker. */
export interface SayStep {
  readonly kind: "say";
  readonly speaker?: SpeakerId;
  /** Literal text (default-locale), and/or an i18n `key`. Markup allowed. */
  readonly text: string;
  readonly key?: string;
  /** Expression variant for the speaker's avatar (e.g. "happy", "angry"). */
  readonly expression?: string;
  /** Reveal-speed multiplier for this whole line (1 = base). */
  readonly speed?: number;
  /** If set, the line auto-advances after this many ms once fully revealed. */
  readonly autoAdvanceMs?: number;
  readonly commands?: readonly Command[];
  /** Opaque preset name for per-line layout/variant (presenter interprets). */
  readonly view?: string;
  /** Opaque per-line hint bag (presenter/chrome interprets). */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** Voice-clip id (audio handler interprets; reveal may sync to it). */
  readonly voice?: string;
}

export interface ChoiceOption {
  readonly text: string;
  readonly key?: string;
  /** Node to jump to when picked. Omit to just continue the current node. */
  readonly target?: NodeId;
  readonly condition?: Condition;
  /** Hide this option once it has been picked (tracked in `vars`). */
  readonly once?: boolean;
  readonly commands?: readonly Command[];
  /** Opaque per-choice hint bag (tone/icon/position for fancy choice UIs). */
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface ChoiceStep {
  readonly kind: "choice";
  /** Optional prompt shown above the options. */
  readonly text?: string;
  readonly key?: string;
  readonly speaker?: SpeakerId;
  readonly options: readonly ChoiceOption[];
  /** Presentation preset for the prompt/chrome (e.g. "box"/"bubble"), like a
   *  say's `view` — lets a composite chrome route the choice the same way. */
  readonly view?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Fire commands without showing anything (set a var, emit a game event). */
export interface CommandStep {
  readonly kind: "command";
  readonly commands: readonly Command[];
  /** Optional conditional jump; if `condition` passes, jump to `target`. */
  readonly condition?: Condition;
  readonly target?: NodeId;
}

/** Unconditional jump to another node. */
export interface GotoStep {
  readonly kind: "goto";
  readonly target: NodeId;
}

/** Ends the conversation immediately. */
export interface EndStep {
  readonly kind: "end";
}

export type Step = SayStep | ChoiceStep | CommandStep | GotoStep | EndStep;

export interface DialogueNode {
  readonly id: NodeId;
  readonly steps: readonly Step[];
}

/** How a speaker's avatar is presented (the presenter implementation decides). */
export interface AvatarRef {
  /** "portrait" → a sprite beside the box; "scene" → an existing world entity. */
  readonly kind: "portrait" | "scene";
  /** Presenter-specific handle: a texture id for portraits, an entity name for scene. */
  readonly ref: string;
  /** Map of expression id → presenter-specific variant (texture/frame/anim). */
  readonly expressions?: Record<string, string>;
  /** Side the portrait sits on. Default "left". */
  readonly side?: "left" | "right";
}

export interface SpeakerDef {
  readonly id: SpeakerId;
  /** Display name (literal). */
  readonly name: string;
  /** i18n key for the name. */
  readonly nameKey?: string;
  /** Name-plate tint (0xRRGGBB). */
  readonly color?: number;
  readonly avatar?: AvatarRef;
}

export interface DialogueScript {
  readonly id: string;
  readonly start: NodeId;
  readonly nodes: Record<NodeId, DialogueNode>;
  readonly speakers?: Record<SpeakerId, SpeakerDef>;
  /** Initial branching variables. */
  readonly vars?: VarMap;
}

// ── Parsed inline markup (produced by markup.ts) ───────────────────────────

export interface RunStyle {
  readonly bold?: boolean;
  readonly italic?: boolean;
  /** 0xRRGGBB. */
  readonly color?: number;
  /** Animated effect id applied to the whole run. */
  readonly effect?: EffectId;
  /** Reveal-speed multiplier for characters in this run. */
  readonly speed?: number;
  /**
   * Glossary/interactable term id (`[term=cauldron]…[/term]`). Opaque to the
   * system — the presenter highlights + hit-tests the span; the game maps the
   * id to a definition and renders any tooltip (the system only emits the id).
   * Pointer activation is routed through the text presenter's `termAtPoint`
   * seam and surfaced to the host as `DialogueTermActivatedEvent`.
   */
  readonly term?: string;
}

export type EffectId = "wave" | "shake" | "pulse" | "rainbow";

/** A contiguous span of text sharing one style. */
export interface TextRun {
  readonly text: string;
  readonly style: RunStyle;
}

/** A zero-width control marker interleaved between runs during reveal. */
export interface PauseToken {
  /** Index into the flattened character stream where the pause occurs. */
  readonly atChar: number;
  readonly ms: number;
}

/** Result of parsing one line's markup. */
export interface ParsedText {
  readonly runs: readonly TextRun[];
  readonly pauses: readonly PauseToken[];
  /** Total visible character count across all runs (reveal denominator). */
  readonly length: number;
}
