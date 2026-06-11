/**
 * Adapter-level presenter contracts. The headless {@link DialogueChannels}
 * (core) describe *what* a chrome / choice presenter does; these add the YAGE
 * lifecycle (`mount(scene)` / `dispose()`) the host drives. Concrete renderer
 * presenters ({@link DialogueChrome}, {@link ChoiceListPresenter}) implement
 * these; a ui-react / DOM chrome you write later implements the same shape.
 */

import type { Scene } from "@yagejs/core";
import type { ChromeChannel, ChoiceChannel, TextChannel } from "../core/session.js";

/** YAGE lifecycle shared by the renderer-based presenters. */
export interface Mountable {
  mount(scene: Scene): void;
  dispose(): void;
}

/** Frame / nameplate / continue caret. `setVisible` lets a composite chrome
 *  show/hide a whole variant (e.g. hide the box while a bubble line plays). */
export interface ChromePresenter extends ChromeChannel, Mountable {
  setVisible(visible: boolean): void;
}

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
