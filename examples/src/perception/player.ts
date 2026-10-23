import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { InputManagerKey } from "@yagejs/input";
import { PERCEPTIBLE_TAG } from "@yagejs-addons/perception";
import { SPOTS, TARGET_RADIUS } from "./constants.js";
import { SightLabelEntity } from "./overlays.js";

// ---------------------------------------------------------------------------
// PlayerControl — WASD movement plus debug jumps to each sight check
// ---------------------------------------------------------------------------
class PlayerControl extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly body = this.sibling(RigidBodyComponent);
  private direction = Vec2.ZERO;

  private static readonly SPEED = 180;

  update(): void {
    // Each spot's key is also its input action name (see main.ts).
    for (const [action, spot] of Object.entries(SPOTS)) {
      if (this.input.isJustPressed(action))
        this.body.setPosition(spot.x, spot.y);
    }
    const movement = this.input.getVector("left", "right", "up", "down");
    this.direction = movement.lengthSq() > 0 ? movement.normalize() : Vec2.ZERO;
  }

  fixedUpdate(): void {
    this.body.setVelocity(this.direction.scale(PlayerControl.SPEED));
  }
}

// ---------------------------------------------------------------------------
// PlayerEntity — the target the guard is looking for
// ---------------------------------------------------------------------------

/**
 * `PERCEPTIBLE_TAG` makes the player a candidate of every sensor's default
 * query. Its own collider does not hide it: the physics line-of-sight check
 * counts a first hit on the target as a clear path.
 */
export class PlayerEntity extends Entity {
  setup(): void {
    this.tags.add(PERCEPTIBLE_TAG);
    this.add(new Transform({ position: SPOTS.open }));
    this.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: TARGET_RADIUS },
      }),
    );
    this.add(
      new GraphicsComponent().draw((g) =>
        g.circle(0, 0, TARGET_RADIUS).fill(0x75caff),
      ),
    );
    this.add(new PlayerControl());
    this.spawnChild("sight-label", SightLabelEntity, { target: this });
  }
}
