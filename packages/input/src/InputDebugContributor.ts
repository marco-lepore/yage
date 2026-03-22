import type {
  DebugContributor,
  WorldDebugApi,
  HudDebugApi,
} from "@yage/debug/api";
import type { InputManager } from "./InputManager.js";

const CROSSHAIR_SIZE = 10;
const CROSSHAIR_COLOR = 0xff00ff;

/** Debug contributor that shows pressed actions and pointer position. */
export class InputDebugContributor implements DebugContributor {
  readonly name = "input";
  readonly flags = ["actions", "pointer"] as const;

  constructor(private readonly manager: InputManager) {}

  drawWorld(api: WorldDebugApi): void {
    if (!api.isFlagEnabled("pointer")) return;

    const pos = this.manager.getPointerPosition();
    const g = api.acquireGraphics();
    if (!g) return;

    const size = CROSSHAIR_SIZE / api.cameraZoom;
    const lineWidth = 1 / api.cameraZoom;
    g.moveTo(pos.x - size, pos.y)
      .lineTo(pos.x + size, pos.y)
      .moveTo(pos.x, pos.y - size)
      .lineTo(pos.x, pos.y + size)
      .stroke({ width: lineWidth, color: CROSSHAIR_COLOR });
  }

  drawHud(api: HudDebugApi): void {
    if (!api.isFlagEnabled("actions")) return;

    const pressed = this.manager
      .getActionNames()
      .filter((action) => this.manager.isPressed(action));

    const label = pressed.length > 0 ? pressed.join(", ") : "(none)";
    api.addLine(`Input: ${label}`);

    const groups = this.manager.getGroups();
    if (groups.length > 0) {
      const disabled = groups.filter((g) => !this.manager.isGroupEnabled(g));
      if (disabled.length > 0) {
        api.addLine(`Disabled groups: ${disabled.join(", ")}`);
      }
    }
  }
}
