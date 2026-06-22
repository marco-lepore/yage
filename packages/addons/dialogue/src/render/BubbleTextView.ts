/**
 * A {@link DialogueTextView} that lays its body text inside a diegetic bubble
 * and follows the speaking actor. Per line it asks the shared {@link BubbleLayout}
 * for the bubble size + the speaker anchor, and points the view's origin
 * provider at the bubble's inner top-left. Because the size and anchor come from
 * the SAME owner the companion {@link BubbleChrome} reads, the text always sits
 * inside its frame — no per-presenter sizing copies to drift. All the
 * typewriter / effect / markup machinery is inherited unchanged.
 */

import type { Scene } from "@yagejs/core";
import type { DiagnosticSink } from "../chrome/DialogueUiAdapter.js";
import type { PresentedLine } from "../core/session.js";
import type { BubbleLayout } from "./BubbleLayout.js";
import { DialogueTextView, type DialogueTextConfig } from "./DialogueTextView.js";

export class BubbleTextView extends DialogueTextView {
  private sceneRef?: Scene;

  constructor(
    cfg: Omit<DialogueTextConfig, "box">,
    private readonly layout: BubbleLayout,
  ) {
    super({
      ...cfg,
      // Initial wrap width; updated per line in present() as the bubble widens.
      box: { x: 0, y: 0, width: 0 },
    });
  }

  override mount(scene: Scene): void {
    super.mount(scene);
    this.sceneRef = scene;
  }

  /** Route the missing-actor warning to the engine Logger (the layout owns the
   *  shared anchor resolver). The base view has no diagnostics of its own. */
  setDiagnostics(warn: DiagnosticSink): void {
    this.layout.setDiagnostics(warn);
  }

  override present(line: PresentedLine): void {
    // Size to the same width + height the chrome draws this line at (one shared
    // measurement), so the text sits inside the content-sized bubble — wrapping
    // to the column left of any in-bubble portrait inset.
    const size = this.layout.sizeFor(line);
    this.setBox(0, 0, this.layout.textWrapWidth(size));
    const speakerId = line.speaker?.id;
    // Always anchor: a missing actor resolves to the last-known / fallback
    // position via the shared owner, never pinned at world origin.
    this.setOrigin(() => {
      const anchor = this.sceneRef
        ? this.layout.anchorFor(this.sceneRef, speakerId)
        : { x: 0, y: 0 };
      return this.layout.originFor(anchor, size);
    });
    super.present(line);
  }
}
