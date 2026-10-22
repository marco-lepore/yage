import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { PerceptionSensor } from "@yagejs-addons/perception";
import { GUARD_KEY, LABEL_LAYER, PLAYER_KEY } from "./constants.js";

// ---------------------------------------------------------------------------
// SightLabel — the guard's latest verdict on one target, shown above it
// ---------------------------------------------------------------------------

/**
 * Reads the guard's `evaluations`, which list every candidate from the latest
 * sample with the check that rejected it.
 */
class SightLabel extends Component {
  private readonly text = this.sibling(TextComponent);

  constructor(private readonly target: Entity) {
    super();
  }

  update(): void {
    const sensor = this.scene.findByKey(GUARD_KEY)?.get(PerceptionSensor);
    const evaluation = sensor?.evaluations.find(
      (entry) => entry.entityId === this.target.id,
    );
    this.text.setText(
      evaluation === undefined ? "" : (evaluation.reason ?? "in sight"),
    );
  }
}

/** Child of a target; its Transform offsets the label above the target. */
export class SightLabelEntity extends Entity {
  setup(params: { target: Entity }): void {
    this.add(new Transform({ position: new Vec2(0, -26) }));
    this.add(
      new TextComponent({
        text: "",
        layer: LABEL_LAYER,
        anchor: { x: 0.5, y: 1 },
        style: { fontFamily: "monospace", fontSize: 12, fill: 0xc8d2e0 },
      }),
    );
    this.add(new SightLabel(params.target));
  }
}

// ---------------------------------------------------------------------------
// LastKnownMarker — where the guard last saw the player
// ---------------------------------------------------------------------------

/**
 * Draws a line from the guard to the player's `lastPosition` and a ring
 * there: green while the player is in sight, amber while the guard only
 * remembers it, nothing once the memory is forgotten.
 */
class LastKnownMarker extends Component {
  private readonly graphics = this.sibling(GraphicsComponent);

  update(): void {
    const guard = this.scene.findByKey(GUARD_KEY);
    const player = this.scene.findByKey(PLAYER_KEY);
    const sighting =
      player && guard?.get(PerceptionSensor).observationOf(player);
    this.graphics.draw((g) => {
      g.clear();
      if (!guard || !sighting) return;
      const from = guard.get(Transform).worldPosition;
      const to = sighting.lastPosition;
      const color = sighting.visible ? 0x86de9b : 0xf4be69;
      g.moveTo(from.x, from.y)
        .lineTo(to.x, to.y)
        .stroke({ color, width: 2, alpha: 0.6 });
      g.circle(to.x, to.y, 17).stroke({ color, width: 2 });
    });
  }
}

export class LastKnownMarkerEntity extends Entity {
  setup(): void {
    this.add(new Transform());
    this.add(new GraphicsComponent({ layer: LABEL_LAYER }));
    this.add(new LastKnownMarker());
  }
}
