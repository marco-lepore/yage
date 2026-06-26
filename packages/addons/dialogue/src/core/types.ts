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
  /**
   * Write a variable through the conversation's {@link VariableStorage} — the
   * skill-check seam: a result a blocking command computes (`ctx.setVar("passed",
   * true)`) is read by a later condition. Routes through the same guarded write
   * as the `set` built-in, so a read-only `cells` accessor throws. A stale ctx
   * (after stop/replay) no-ops.
   */
  setVar(name: string, value: VarValue): void;
}

/**
 * A command handler. Return a promise from a `blocking` command to pause the
 * conversation until it resolves (cinematic sequencing). Handlers are installed
 * on the controller (`commands` map + optional `fallbackCommand`), with optional
 * per-`play()` overrides.
 */
export type CommandHandler = (
  command: Command,
  ctx: CommandContext,
) => void | Promise<void>;

/**
 * A boolean guard on a choice or step. Resolved against the conversation's
 * {@link VariableStorage} + installed functions:
 *
 * - a bare name (`"greeted"`) → truthy check on that variable;
 * - an atomic comparison `{ var, op, value }` (the degenerate one-level tree);
 * - a full {@link Expr} tree (`and`/`or`, arithmetic, `has_item("key")`, …);
 * - a `(vars) => boolean` predicate — TS-only, receives a materialized snapshot
 *   of the readable variables (doesn't survive JSON).
 */
export type Condition =
  | string
  | { readonly var: string; readonly op: CompareOp; readonly value: unknown }
  | Expr
  | ((vars: VarMap) => boolean);

/** Operators for the atomic `{ var, op, value }` condition (the degenerate
 *  comparison tree). Full expression trees use {@link BinaryOp}/{@link UnaryOp}. */
export type CompareOp = "==" | "!=" | ">" | ">=" | "<" | "<=" | "truthy" | "falsy";

export type VarValue = string | number | boolean | null;
export type VarMap = Record<string, VarValue>;

// ── Expression IR (D5) ──────────────────────────────────────────────────────
// `Condition` and a `set`'s value are expression *trees*, not atomic
// comparisons — so `gold - 50` (the landmine the old flat form couldn't express)
// and `has_item("key") and not rude` are plain data. The operator set is modeled
// on Yarn Spinner so a future Yarn front-end maps 1:1 onto this IR.

/** Comparison operators (symbol + Yarn word forms). `is`/`eq` ≡ `==`. */
export type ComparisonOp =
  | "==" | "!=" | ">" | "<" | ">=" | "<="
  | "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "is";
/** Boolean operators (symbol + word forms). */
export type LogicalOp = "and" | "&&" | "or" | "||" | "xor" | "^";
/** Arithmetic operators. `+` concatenates when either operand is a string. */
export type ArithmeticOp = "+" | "-" | "*" | "/" | "%";
export type BinaryOp = ComparisonOp | LogicalOp | ArithmeticOp;
/** Unary operators: logical negation (`not`/`!`) and numeric negation (`-`). */
export type UnaryOp = "not" | "!" | "-";

/** An expression node. Evaluates to a {@link VarValue} against an eval scope
 *  (variable reads + installed functions). */
export type Expr =
  | { readonly kind: "literal"; readonly value: VarValue }
  | { readonly kind: "varRef"; readonly name: string }
  | { readonly kind: "call"; readonly fn: string; readonly args?: readonly Expr[] }
  | { readonly kind: "unary"; readonly op: UnaryOp; readonly operand: Expr }
  | {
      readonly kind: "binary";
      readonly op: BinaryOp;
      readonly left: Expr;
      readonly right: Expr;
    }
  | { readonly kind: "group"; readonly expr: Expr };

/**
 * The read/write bridge between a conversation and game state (Yarn's
 * `VariableStorage` shape). Names are **opaque** — the runtime imposes no
 * meaning on a name's characters; scoping/prefixing/nesting is the host's
 * policy. The addon ships a zero-config {@link MemoryVariableStorage}; a host
 * can supply its own or {@link compose} several (a {@link cells} accessor over
 * game state, an in-memory default for dialogue-locals + seeds, …). Storage
 * **persists** across `play()`s.
 */
export interface VariableStorage {
  /** Read a variable, or `undefined` if absent. */
  get(name: string): VarValue | undefined;
  /** Write a variable. A read-only accessor (a `cells` getter without a setter)
   *  throws. */
  set(name: string, value: VarValue): void;
  /** Whether the storage currently holds `name` (drives seed-if-absent). */
  has(name: string): boolean;
  /**
   * Enumerate the readable `(name, value)` pairs — backs `{token}` interpolation
   * params, `handle.getVars()`, and the `(vars) => boolean` predicate. A fully
   * opaque game store may enumerate fewer names; those then won't interpolate or
   * appear in `getVars()`, but direct `get`/`set`/`has` still work.
   */
  entries(): Iterable<readonly [string, VarValue]>;
}

/**
 * A pure, argument-capable read installed on the controller (`functions`). The
 * read-only counterpart to a `command`: `has_item("rusty-key")` in a condition.
 * Zero-arg reads need no function — a bare name reads {@link VariableStorage}.
 * MUST be cheap + side-effect-free (called on every condition test).
 */
export type DialogueFunction = (...args: VarValue[]) => VarValue;

/**
 * Per-`play()` overrides, layered over the controller-installed
 * storage/functions/commands for entity-specifics. `storage` replaces the
 * controller's (use {@link compose} to layer); `functions`/`commands` merge
 * key-by-key with the call site winning; `fallbackCommand` wins when set.
 */
export interface DialoguePlayOptions {
  readonly storage?: VariableStorage | undefined;
  readonly functions?: Readonly<Record<string, DialogueFunction>> | undefined;
  readonly commands?: Readonly<Record<string, CommandHandler>> | undefined;
  readonly fallbackCommand?: CommandHandler | undefined;
}

/**
 * The typed, per-conversation handle returned by `play()`. Lets the host poke
 * variables live (`setVar`) and read them back (`getVars`) without growing
 * string-keyed methods on the controller. Generation-stamped: after
 * `stop()`/replay a stale handle no-ops (`setVar`) / returns an empty snapshot
 * (`getVars`).
 */
export interface DialogueHandle<Vars extends VarMap = VarMap> {
  /** Write a variable through the conversation's storage (guarded). On the
   *  {@link defineScript} path both the name AND the value are typed to the
   *  script's declared variables — a wrong-typed value is a compile error.
   *  (`ctx.setVar` stays loosely typed: command handlers are installed on the
   *  controller, not bound to any one script's variable types.) */
  setVar<K extends keyof Vars & string>(name: K, value: Vars[K]): void;
  /** Snapshot of the storage's enumerable variables. */
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
  /** Hide this option once it has been picked. Tracked as per-conversation
   *  cursor state (resets on a fresh `play()`; the future save cursor captures
   *  it), NOT in the variable storage. */
  readonly once?: boolean;
  /**
   * What to do when this option's {@link condition} is **false**. Default
   * `"hidden"` (the option is filtered out). `"disabled"` keeps it on screen as
   * a non-selectable, greyed-out row (the Disco-Elysium "[Strength 8] Force the
   * door" pattern — the player learns the gate exists). Governs condition
   * failures only: a spent `once` option is **always** hidden regardless. A step
   * whose only-enabled count drops to zero is skipped, so a disabled row never
   * causes a soft-lock.
   */
  readonly presentation?: "hidden" | "disabled";
  /** Short reason shown beside a `"disabled"` row where the layout allows (e.g.
   *  "Requires the rusty key"). Resolved through the i18n adapter, so `{token}`s
   *  interpolate; there is no separate i18n `key` for it. */
  readonly disabledReason?: string;
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
   * Declared variable **defaults** (Yarn `<<declare>>` / `InitialValues`). On
   * `play()`, each applies **only if the installed storage doesn't already
   * `has` the name** (seed-if-absent) — a game-linked value always wins, the
   * addon never clobbers. The default's value also fixes the variable's inferred
   * type on the {@link defineScript} path. Variables **persist** in storage
   * across plays (cycling-NPC counters, quest progress); a script re-inits a
   * value explicitly to reset it. (A choice's `once` flag is per-conversation
   * cursor state, not a stored variable — see {@link ChoiceOption.once}.)
   */
  readonly declare?: VarMap;
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

/**
 * A self-closing inline marker (`[name k=v/]`) that fires as a **reveal event**
 * when the typewriter cursor reaches its char offset — the sibling of
 * {@link PauseToken}, but a one-shot consequence rather than a timing hold. The
 * canonical use is positional SFX (`[sfx=ding/]`) and a mid-line face change
 * (`[expression=happy/]`); the addon interprets none of the names (the avatar
 * channel reads `[expression]`, the host reads the rest). The Yarn self-named
 * shortcut `[name=val/]` → `props { [name]: val }`.
 */
export interface MarkerToken {
  /** Grapheme index into the flattened text where the marker fires. */
  readonly atChar: number;
  /** Marker name (lower-cased), e.g. `expression`, `sfx`, `shake`. */
  readonly name: string;
  /** Parsed `key=value` props (all string-valued). `[expression=happy/]` →
   *  `{ expression: "happy" }` via the self-named shortcut. */
  readonly props: Readonly<Record<string, string>>;
}

/** Result of parsing one line's markup. */
export interface ParsedText {
  readonly runs: readonly TextRun[];
  readonly pauses: readonly PauseToken[];
  /** Inline reveal markers, in char order. Empty when the line has none. */
  readonly markers: readonly MarkerToken[];
  /** Total grapheme count across all runs (the reveal denominator). */
  readonly length: number;
}
