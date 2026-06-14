/**
 * `defineScript` — the TS-first authoring path (D4). An identity function at
 * runtime; at compile time it captures the script's declared variable value
 * types (from their {@link DialogueScript.declare} defaults), branding the
 * returned script so `play()` can hand back a typed {@link DialogueHandle}.
 *
 * JSON scripts (a plain {@link DialogueScript} literal) get the exact same
 * runtime rules via load-/play-time validation — the brand is a pure
 * compile-time convenience and never exists at runtime. Inference stays shallow:
 * it lives here and at the `play()` boundary, never threaded through the
 * session/controller internals.
 *
 *     const script = defineScript({
 *       id: "shop", start: "n",
 *       declare: { greeted: false, gold: 0 },   // greeted: boolean, gold: number
 *       nodes: { n: { id: "n", steps: [{ kind: "end" }] } },
 *     });
 *     const handle = controller.play(script);    // content-only
 *     handle.setVar("greeted", true);            // ^ key is typed to keyof declare
 */

import type {
  DialogueNode,
  DialogueScript,
  NodeId,
  SpeakerDef,
  SpeakerId,
  VarMap,
} from "./types.js";

declare const VARS_BRAND: unique symbol;

/** Phantom carrier of a script's captured variable types. Never present at
 *  runtime — only `defineScript`'s cast asserts it. */
interface ScriptTypes<V extends VarMap> {
  readonly [VARS_BRAND]: V;
}

/** A {@link DialogueScript} branded with its declared variable types. */
export type TypedScript<V extends VarMap> = DialogueScript & ScriptTypes<V>;

export function defineScript<V extends VarMap = Record<never, never>>(
  script: Omit<DialogueScript, "declare"> & {
    readonly id: string;
    readonly start?: NodeId;
    readonly nodes: Record<NodeId, DialogueNode>;
    readonly speakers?: Record<SpeakerId, SpeakerDef>;
    readonly declare?: V;
  },
): TypedScript<V> {
  return script as unknown as TypedScript<V>;
}

/** Declared variable types captured for a script (the loose {@link VarMap} for a
 *  plain JSON script). Drives the typed {@link DialogueHandle} `play()` returns. */
export type VarsOf<S> = S extends ScriptTypes<infer V> ? V : VarMap;
