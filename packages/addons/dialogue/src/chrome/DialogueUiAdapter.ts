/**
 * Adapter-level presenter contracts. The headless {@link DialogueChannels}
 * (core) describe *what* a chrome / choice presenter does; these add the YAGE
 * lifecycle (`mount(scene)` / `dispose()`) the host drives. Concrete renderer
 * presenters ({@link DialogueChrome}, {@link ChoiceListPresenter}) implement
 * these; a ui-react / DOM chrome you write later implements the same shape.
 */

import type { Scene } from "@yagejs/core";
import type { ChromeChannel, ChoiceChannel, TextChannel } from "../core/session.js";

/** A dev-facing diagnostics sink — the controller wires this to the engine
 *  Logger (the same seam as the session's `onError`), so a presenter-level
 *  warning (e.g. a missing actor) routes there instead of `console.warn`. */
export type DiagnosticSink = (message: string) => void;

/** YAGE lifecycle shared by the renderer-based presenters. */
export interface Mountable {
  mount(scene: Scene): void;
  dispose(): void;
  /** Optional: receive a diagnostics sink (D3). The controller injects one at
   *  mount so a presenter can report dev-facing issues (a missing actor) through
   *  the engine Logger. Presenters with nothing to report omit it. */
  setDiagnostics?(warn: DiagnosticSink): void;
}

/** Frame / nameplate / continue caret. `setVisible` (now part of
 *  {@link ChromeChannel}) lets a composite chrome show/hide a whole variant
 *  (e.g. hide the box while a bubble line plays). */
export interface ChromePresenter extends ChromeChannel, Mountable {}

/** The choice list / wheel / panel. Optionally hit-tests pointer coords so a
 *  pointer binding can hover/click rows ({@link PointerChoiceTarget}). The
 *  hit-test (and `pointerSpace`) are read in screen space by default; a
 *  world-anchored presenter (e.g. a bubble) sets `pointerSpace: "world"`. */
export interface ChoicePresenter extends ChoiceChannel, Mountable {
  choiceAtPoint?(x: number, y: number): number | undefined;
  /** Coordinate space `choiceAtPoint` expects. Default "screen". */
  readonly pointerSpace?: "screen" | "world";
}

/**
 * Body-text presenter: the headless {@link TextChannel} (reveal timing) plus the
 * YAGE lifecycle the host drives.
 *
 * This contract lives in this pixi-free adapter module — NOT on the concrete,
 * renderer-backed `DialogueTextView` — so the headless root entry (`"."`) can
 * reach it through the `DialogueController` without transitively importing
 * `@yagejs/renderer`. The renderer-backed views only *implement* this shape.
 */
export interface TextPresenter extends TextChannel, Mountable {}
