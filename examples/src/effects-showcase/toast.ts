import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  type ProcessSlot,
} from "@yagejs/core";
import { TextComponent } from "@yagejs/renderer";
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT } from "./constants.js";

/** How long a toast stays on screen, in seconds of scene time. */
const TOAST_SECONDS = 1.5;

/**
 * In-canvas toast. `show()` reveals a message; a ProcessComponent slot hides
 * it again after TOAST_SECONDS of scene time, so pausing the scene also holds
 * the toast.
 */
export class Toast extends Component {
  private readonly text = this.sibling(TextComponent);
  private readonly processes = this.sibling(ProcessComponent);
  private lifetime!: ProcessSlot;

  onAdd(): void {
    this.lifetime = this.processes.slot({
      duration: TOAST_SECONDS,
      onComplete: () => {
        this.text.visible = false;
      },
    });
  }

  /** Show `message`, replacing any toast still on screen. */
  show(message: string): void {
    this.text.setText(message);
    this.text.visible = true;
    this.lifetime.restart();
  }
}

/** One status line centred at the bottom of the canvas, on the "ui" layer. */
export class ToastEntity extends Entity {
  toast!: Toast;

  setup(): void {
    this.add(
      new Transform({
        position: new Vec2(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT - 28),
      }),
    );
    this.add(
      new TextComponent({
        text: "",
        anchor: { x: 0.5, y: 0.5 },
        style: { fontFamily: "monospace", fontSize: 13, fill: 0x22c55e },
        layer: "ui",
        visible: false,
      }),
    );
    this.add(new ProcessComponent());
    this.toast = this.add(new Toast());
  }
}
