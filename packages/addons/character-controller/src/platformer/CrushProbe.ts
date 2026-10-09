import { finite, interactionGroup } from "../core/validate.js";
import {
  Component,
  defineEvent,
  type Entity,
  type Vec2Like,
} from "@yagejs/core";
import {
  ColliderComponent,
  PhysicsWorldKey,
  RigidBodyComponent,
  type PhysicsWorld,
} from "@yagejs/physics";

export const PlatformerCrushedEvent = defineEvent<{
  surface: Entity;
  obstruction: Entity;
  direction: Vec2Like;
}>("character-controller:platformer:crushed");
/** Numerical overlap below this depth is ordinary resting contact, not a crush. */
const CONTACT_SLOP = 0.5;

/** Tests mandatory platform pushes after stance and movement resolve. Never writes a body. */
export class CrushProbe extends Component {
  private world!: PhysicsWorld;
  private collider!: ColliderComponent;
  private body!: RigidBodyComponent;
  private pending: { surface: ColliderComponent; delta: Vec2Like }[] = [];

  constructor(private readonly filterGroups: number) {
    super();
    interactionGroup("CrushProbe", "filterGroups", filterGroups);
  }
  onAdd(): void {
    this.world = this.use(PhysicsWorldKey);
    this.collider = this.entity.get(ColliderComponent);
    this.body = this.entity.get(RigidBodyComponent);
  }
  consider(surface: ColliderComponent, delta: Vec2Like): void {
    finite("CrushProbe.consider", "delta.x", delta.x);
    finite("CrushProbe.consider", "delta.y", delta.y);
    if (this.effectiveEnabled)
      this.pending.push({ surface, delta: { x: delta.x, y: delta.y } });
  }
  onDisable(): void {
    this.pending = [];
  }
  fixedUpdate(dt: number): void {
    finite("CrushProbe.fixedUpdate", "dt", dt, 0);
    const pending = this.pending;
    this.pending = [];
    const shape = this.collider.config.shape;
    if (!shape || dt <= 0) return;
    const offset = this.collider.config.offset ?? { x: 0, y: 0 };
    const origin = {
      x: this.body.positionX + offset.x,
      y: this.body.positionY + offset.y,
    };
    for (const { surface, delta } of pending) {
      const contact = surface.contactWith(this.collider, {
        prediction: Math.hypot(delta.x, delta.y) + CONTACT_SLOP,
        solidOnly: true,
      });
      if (!contact) continue;
      const n = contact.normal;
      const advance = delta.x * n.x + delta.y * n.y;
      if (advance <= 0) continue;
      const required = advance - contact.distance;
      if (required <= CONTACT_SLOP) continue;
      // Preserve the player's chosen tangential escape. Only the normal part
      // is compulsory; carrying along a platform's top is not a push.
      const own = { x: this.body.velocityX * dt, y: this.body.velocityY * dt };
      const normalTravel = own.x * n.x + own.y * n.y;
      const tangent = {
        x: own.x - normalTravel * n.x,
        y: own.y - normalTravel * n.y,
      };
      const tangentLength = Math.hypot(tangent.x, tangent.y);
      const options = {
        filterGroups: this.filterGroups,
        solidFor: this.collider,
        excludeEntity: surface.entity,
        stopAtPenetration: false,
      };
      let fraction = 1;
      if (tangentLength > 0.001) {
        const blocked = this.world.castShape(
          shape,
          origin,
          { x: tangent.x / tangentLength, y: tangent.y / tangentLength },
          tangentLength,
          options,
        );
        if (blocked) fraction = blocked.distance / tangentLength;
      }
      const escaped = {
        x: origin.x + tangent.x * fraction,
        y: origin.y + tangent.y * fraction,
      };
      // Compare the translated platform against the actor in the actor's
      // tangential frame. A room cast could hide this platform behind the floor.
      const surfaceBody = surface.entity.get(RigidBodyComponent);
      const surfaceShape = surface.config.shape;
      const surfaceOffset = surface.config.offset ?? { x: 0, y: 0 };
      if (
        !surfaceShape ||
        !this.world
          .queryShape(
            surfaceShape,
            {
              x:
                surfaceBody.positionX +
                surfaceOffset.x +
                delta.x -
                tangent.x * fraction,
              y:
                surfaceBody.positionY +
                surfaceOffset.y +
                delta.y -
                tangent.y * fraction,
            },
            { excludeEntity: surface.entity },
          )
          .includes(this.entity)
      )
        continue;
      const hit = this.world.castShape(shape, escaped, n, required, options);
      if (!hit || hit.normal.x * n.x + hit.normal.y * n.y > -0.9) continue;
      // Moving blockers need a joint prediction of both surfaces. Sloped
      // blockers may allow sliding escape; this pass covers fixed opposing faces.
      if (hit.entity.tryGet(RigidBodyComponent)?.type !== "static") continue;
      if (required - hit.distance <= CONTACT_SLOP) continue;
      this.entity.emit(PlatformerCrushedEvent, {
        surface: surface.entity,
        obstruction: hit.entity,
        direction: { x: n.x, y: n.y },
      });
      return;
    }
  }
}
