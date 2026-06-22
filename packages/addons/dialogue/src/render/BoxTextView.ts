/**
 * A {@link DialogueTextView} that reads its body-text region from the shared
 * {@link BoxLayout} instead of a fixed box. Per line it wraps to the owner's
 * current text region (which the owner narrows for a registered avatar inset, so
 * the text reflows around it) and tracks the region's top-left via the origin
 * provider, so when `meta.position` moves the frame or a choice grows it, the
 * body follows. This mirrors {@link BubbleTextView}, which follows the speaker
 * anchor the same way.
 */

import type { PresentedLine } from "../core/session.js";
import type { BoxLayout } from "./BoxLayout.js";
import { DialogueTextView, type DialogueTextConfig } from "./DialogueTextView.js";

export class BoxTextView extends DialogueTextView {
  constructor(
    cfg: Omit<DialogueTextConfig, "box">,
    private readonly layout: BoxLayout,
  ) {
    super({ ...cfg, box: { x: 0, y: 0, width: 0 } });
  }

  override present(line: PresentedLine): void {
    // Wrap to the owner's current region width (insets already applied — the
    // avatar registers its column before the session presents the text), and
    // follow the region's top-left so a moved/grown frame carries the text.
    const region = this.layout.textRegion();
    this.setBox(0, 0, region.width);
    this.setOrigin(() => {
      const r = this.layout.textRegion();
      return { x: r.x, y: r.y };
    });
    super.present(line);
  }
}
