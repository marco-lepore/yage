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
export interface CommandContext<Vars extends VarMap = VarMap> {
  readonly mode: RunMode;
  /**
   * Write a dialogue var (a name declared in `script.vars`) — the skill-check
   * seam: a result that only matters to THIS conversation is written here
   * instead of round-tripping through game state. Throws on an external or
   * unknown name (game state is read-only to the script; mutate it via a
   * command). A stale ctx (after stop/replay) writes the abandoned
   * conversation's vars and has no effect on the live one.
   */
  setVar(key: keyof Vars & string, value: VarValue): void;
}

/**
 * A command handler. Return a promise from a `blocking` command to pause the
 * conversation until it resolves (cinematic sequencing). Handlers are injected
 * through a {@link DialogueBinding} (`commands` map + optional `fallbackCommand`).
 */
export type CommandHandler<Vars extends VarMap = VarMap> = (
  command: Command,
  ctx: CommandContext<Vars>,
) => void | Promise<void>;

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

/**
 * Declared type of an **external** (game-state) name. String-literal names so
 * `script.external` stays plain JSON data. The host's binding must provide a
 * matching value/getter for every declared external (see {@link DialogueBinding}).
 */
export type ExternalTypeName = "string" | "number" | "boolean";

/**
 * A live read into game state. Bound for an **external** name and invoked at
 * read time, so `{gold}` / a choice gate reflects the latest value. MUST be
 * cheap and side-effect-free — the runner may call it on every condition test
 * and every line/choice present.
 */
export type VarGetter = () => VarValue;

/** A binding entry: a constant (vars or externals) or a getter (externals only
 *  — dialogue vars are conversation-local and bound by value). */
export type BindingValue = VarValue | VarGetter;

/**
 * The host's bridge into a conversation, supplied at `play()` (and/or as a
 * controller-level default that the call-site binding overrides). It is the one
 * coherent vars story that replaces the old `params` + `onCommand`:
 *
 * - `state` provides every declared **external** (constant or getter) and may
 *   override a declared **var**'s default (by value). Names not in
 *   `script.vars` ∪ `script.external` are a play-time error.
 * - `commands` maps a command `type` → handler; `fallbackCommand` catches
 *   dynamically-typed commands. Every command `type` a script uses must resolve
 *   to a handler (or the fallback), else play-time error — the `set`/`expression`
 *   built-ins are exempt.
 */
export interface DialogueBinding<Vars extends VarMap = VarMap> {
  readonly state?: Readonly<Record<string, BindingValue>> | undefined;
  readonly commands?: Readonly<Record<string, CommandHandler<Vars>>> | undefined;
  readonly fallbackCommand?: CommandHandler<Vars> | undefined;
}

/**
 * The typed, per-conversation handle returned by `play()`. Lets the host poke
 * dialogue vars live (`setVar`) and read them back (`getVars`) without growing
 * string-keyed methods on the controller. Generation-stamped: after
 * `stop()`/replay a stale handle no-ops (`setVar`) / returns an empty snapshot
 * (`getVars`).
 */
export interface DialogueHandle<Vars extends VarMap = VarMap> {
  /** Write a dialogue var (∈ `script.vars`). Throws on an external/unknown name. */
  setVar(key: keyof Vars & string, value: VarValue): void;
  /** Snapshot of the current dialogue vars (externals excluded). */
  getVars(): Readonly<Vars>;
}

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
  /**
   * Dialogue vars: conversation-lifetime branching state. Each entry declares a
   * name, its default value, and (by `typeof`) its type. Reset fresh on every
   * `play()`; mutated by `set` / `ctx.setVar` / `handle.setVar`; a binding may
   * override a default by value.
   */
  readonly vars?: VarMap;
  /**
   * Externals: game-lifetime state the script READS (never writes). Declared by
   * name → type so the loader can type-check conditions/tokens without a binding
   * present. The host supplies each one (constant or live getter) at `play()`;
   * the script mutates them only as commands (rules-in / consequences-out).
   */
  readonly external?: Record<string, ExternalTypeName>;
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
}

export type EffectId = "wave" | "shake" | "pulse" | "rainbow";

/** A contiguous span of text sharing one style. */
export interface TextRun {
  readonly text: string;
  readonly style: RunStyle;
  /**
   * Number of graphemes (user-perceived characters) in `text` — NOT
   * `text.length`. All reveal bookkeeping counts graphemes, because that is
   * the unit the renderer splits into glyph nodes (one per grapheme), so an
   * emoji / ZWJ sequence / combining mark counts as 1.
   */
  readonly graphemeCount: number;
}

/** A zero-width control marker interleaved between runs during reveal. */
export interface PauseToken {
  /** Grapheme index into the flattened text where the pause occurs. */
  readonly atChar: number;
  readonly ms: number;
}

/** Result of parsing one line's markup. */
export interface ParsedText {
  readonly runs: readonly TextRun[];
  readonly pauses: readonly PauseToken[];
  /** Total grapheme count across all runs (the reveal denominator). */
  readonly length: number;
}
