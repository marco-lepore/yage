import { Entity, Transform, Vec2 } from "@yagejs/core";
import { TextComponent } from "@yagejs/renderer";
import { Anchor, UISurface } from "@yagejs/ui";
import type { UIPanel } from "@yagejs/ui";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

/** The width the panel is laid out at. */
const PANEL_WIDTH = 200;

/** What the text and UI case reports. */
export interface TextUiReading extends CaseReading {
  textWidth: number;
  panelWidth: number;
  panelHeight: number;
}

/** Reads the drawn text's width and the panel's computed Yoga box. */
export class TextUiProbe extends CaseProbe {
  private readonly text = this.sibling(TextComponent);

  constructor(private readonly panel: UIPanel) {
    super();
  }

  get settled(): boolean {
    return this.panel.yogaNode.getComputedWidth() === PANEL_WIDTH;
  }

  reading(): TextUiReading {
    return {
      textWidth: this.text.renderObject.width,
      panelWidth: this.panel.yogaNode.getComputedWidth(),
      panelHeight: this.panel.yogaNode.getComputedHeight(),
    };
  }
}

/** A text object and a Yoga-laid-out panel holding a label. */
export class TextUiCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(320, 40) }));
    this.add(
      new TextComponent({
        text: "YAGE baseline",
        style: { fill: 0xe2e8f0, fontSize: 18 },
      }),
    );
    const surface = this.add(
      new UISurface({ anchor: Anchor.TopRight, offset: { x: -8, y: 8 } }),
    );
    const panel = surface.panel({ width: PANEL_WIDTH, padding: 10 });
    panel.text("Panel label", { fontSize: 14 });
    this.add(new TextUiProbe(panel));
  }
}
