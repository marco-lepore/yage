import { Component, MathUtils, Transform } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";

export interface TopDownPlayerMoverOptions {
  speed: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  isBlocked?: () => boolean;
}

/** Normalized movement within live bounds, with an optional input owner. */
export class TopDownPlayerMover extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  constructor(private readonly options: TopDownPlayerMoverOptions) {
    super();
  }

  update(dt: number): void {
    if (this.options.isBlocked?.()) return;
    const dx = this.input.getAxis("move-left", "move-right");
    const dy = this.input.getAxis("move-up", "move-down");
    if (dx === 0 && dy === 0) return;
    const step = (this.options.speed * dt) / Math.hypot(dx, dy);
    const bounds = this.options.bounds;
    const position = this.transform.position;
    this.transform.setPosition(
      MathUtils.clamp(position.x + dx * step, bounds.minX, bounds.maxX),
      MathUtils.clamp(position.y + dy * step, bounds.minY, bounds.maxY),
    );
  }
}
