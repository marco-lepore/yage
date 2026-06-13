/**
 * `defineScript` — the TS-first authoring path (D5). An identity function at
 * runtime; at compile time it captures the script's **var** value types (from
 * their defaults) and its **external** type names, branding the returned script
 * so `play()` can demand a matching binding and hand back a typed handle.
 *
 * JSON scripts (a plain {@link DialogueScript} literal) get the exact same
 * runtime rules via load-/play-time validation — the brand is a pure
 * compile-time convenience and never exists at runtime. Inference stays shallow:
 * it lives here and at the `play()` boundary, never threaded through the
 * session/controller internals.
 *
 *     const script = defineScript({
 *       id: "shop", start: "n",
 *       vars: { greeted: false },              // greeted: boolean
 *       external: { gold: "number" },          // gold: number (read-only)
 *       nodes: { n: { id: "n", steps: [{ kind: "end" }] } },
 *     });
 *     controller.play(script, { state: { gold: () => player.gold } });
 *     //                                ^ required + type-checked
 */

import type {
  CommandHandler,
  DialogueBinding,
  DialogueNode,
  DialogueScript,
  ExternalTypeName,
  NodeId,
  SpeakerDef,
  SpeakerId,
  VarMap,
} from "./types.js";

declare const VARS_BRAND: unique symbol;
declare const EXT_BRAND: unique symbol;

/** Phantom carrier of a script's captured var/external types. Never present at
 *  runtime — only `defineScript`'s cast asserts it. */
interface ScriptTypes<
  V extends VarMap,
  E extends Record<string, ExternalTypeName>,
> {
  readonly [VARS_BRAND]: V;
  readonly [EXT_BRAND]: E;
}

/** A {@link DialogueScript} branded with its var/external types. */
export type TypedScript<
  V extends VarMap,
  E extends Record<string, ExternalTypeName>,
> = DialogueScript & ScriptTypes<V, E>;

export function defineScript<
  V extends VarMap = Record<never, never>,
  const E extends Record<string, ExternalTypeName> = Record<never, never>,
>(
  script: Omit<DialogueScript, "vars" | "external"> & {
    readonly id: string;
    readonly start?: NodeId;
    readonly nodes: Record<NodeId, DialogueNode>;
    readonly speakers?: Record<SpeakerId, SpeakerDef>;
    readonly vars?: V;
    readonly external?: E;
  },
): TypedScript<V, E> {
  return script as unknown as TypedScript<V, E>;
}

// ── play()-boundary helpers (used by session + controller signatures) ────────

type ExternalValueOf<T extends ExternalTypeName> = T extends "string"
  ? string
  : T extends "number"
    ? number
    : boolean;

/** The `state` a typed script requires: every external (constant or live
 *  getter), plus optional by-value overrides for declared vars. */
export type BindingStateFor<
  V extends VarMap,
  E extends Record<string, ExternalTypeName>,
> = {
  readonly [K in keyof E]: ExternalValueOf<E[K]> | (() => ExternalValueOf<E[K]>);
} & {
  readonly [K in keyof V]?: V[K];
};

/** A fully-typed binding for a {@link defineScript} script. */
export interface TypedBinding<
  V extends VarMap,
  E extends Record<string, ExternalTypeName>,
> {
  readonly state: BindingStateFor<V, E>;
  readonly commands?: Readonly<Record<string, CommandHandler<V>>> | undefined;
  readonly fallbackCommand?: CommandHandler<V> | undefined;
}

/** Dialogue-var types captured for a script (defaults to the loose `VarMap`). */
export type VarsOf<S> = S extends ScriptTypes<infer V, Record<string, ExternalTypeName>>
  ? V
  : VarMap;

type ExternalsOf<S> = S extends ScriptTypes<VarMap, infer E> ? E : Record<never, never>;

/** The binding type accepted for a script: typed for a `defineScript` script,
 *  the loose {@link DialogueBinding} for a plain JSON script. */
export type BindingFor<S> = S extends ScriptTypes<infer V, infer E>
  ? TypedBinding<V, E>
  : DialogueBinding;

/**
 * The `play()` binding parameter, as a tuple so it is **required** when the
 * script declares externals and **optional** otherwise (a plain JSON script, or
 * a typed script with no externals).
 */
export type PlayBindingArgs<S> = [keyof ExternalsOf<S>] extends [never]
  ? [binding?: BindingFor<S>]
  : [binding: BindingFor<S>];
