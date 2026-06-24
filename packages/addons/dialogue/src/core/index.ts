export * from "./types.js";
export { parseMarkup, stripMarkup, splitGraphemes } from "./markup.js";
// Headless typewriter clock — a custom text presenter reuses it to honour
// reveal timing / pauses / per-run speed / completion without re-implementing.
export { LineReveal } from "./LineReveal.js";
export { loadScript, DialogueScriptError } from "./formats/canonical.js";
// Compact authoring DSL (`parseCompact` → IR; `loadCompact` → validated IR). It
// imports only the headless core (no `yaml`, no pixi), so unlike `loadYaml` it
// stays on the root entry.
export { parseCompact, loadCompact } from "./formats/compact.js";
// NB: the YAML-literal front-end (`loadYaml`) is intentionally NOT re-exported
// here. It lives behind the `@yagejs-addons/dialogue/yaml` subpath so the `yaml`
// runtime dep stays out of the root/JSON/expression import graph (it can't be
// tree-shaken — yaml@2 isn't flagged side-effect-free). See `../yaml.ts`.
export { DialoguePlayError } from "./validate.js";
export { defineScript } from "./defineScript.js";
export type { TypedScript, VarsOf } from "./defineScript.js";
// Variable storage kit (the host's bridge to game state).
export { MemoryVariableStorage, cells, compose, materialize } from "./vars.js";
export type { Cell } from "./vars.js";
// Expression evaluator (conditions + `set` values).
export { evaluate, evalCondition, isExpr } from "./expr.js";
export type { EvalScope } from "./expr.js";
// String → expression front-end: parses a condition / `set` string (`"hp > 0 and
// has_item('key')"`) into the same Expr tree. Used by loadScript's pre-walk.
export { parseExpr, DialogueExprError } from "./expr-parse.js";
// `createScope` (expr.ts) and `tokensIn` (i18n.ts) are intentionally NOT exported
// — internal plumbing; `session.ts`/`runner.ts`/`validate.ts` import them by path.
export { DialogueRunner } from "./runner.js";
export type { RunnerHandlers, ResolvedChoice, RunnerEnv } from "./runner.js";
export { IdentityI18n, interpolate } from "./i18n.js";
export type { I18nAdapter } from "./i18n.js";
export { DialogueSession } from "./session.js";
export type {
  DialogueChannels,
  DialogueSessionOptions,
  PresentedLine,
  PresentedChoice,
  PreviewedLine,
  SpeakerView,
  ChoiceContext,
  TextChannel,
  ChoiceChannel,
  AvatarChannel,
  ChromeChannel,
} from "./session.js";
// Extensible channels: the optional-hook channel a host registers (Voice / Shop /
// CameraEffects / History), plus the built-in voice-over channel. The trio above
// stays the typed built-in path; these are purely additive.
export type { DialogueExtraChannel } from "./channels/index.js";
export { createVoiceChannel } from "./channels/index.js";
export type { VoiceChannelOptions, VoiceHandle } from "./channels/index.js";
