import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import {
  createPlatformer,
  LedgeProbe,
  type PlatformerCharacter,
} from "@yagejs-addons/character-controller/platformer";
import { LedgeClimb } from "./ledge.js";
import type { Vec2Like } from "@yagejs/core";
import { COLORS, GROUND_GROUPS, SOLID_GROUPS } from "./constants.js";

/** The visual follows the stance; the physics transform stays upright. */
class PlayerVisual extends Component {
  constructor(
    private readonly character: PlatformerCharacter,
    private readonly visual: GraphicsComponent,
  ) {
    super();
  }
  update(): void {
    const { controller, stance, moves } = this.character;
    const height = stance.crouched ? 30 : 44;
    const color = moves.dashing ? 0xfbbf24 : COLORS.player;
    this.visual.draw((g) => {
      g.clear();
      g.roundRect(-8, -height, 16, height, 4).fill({ color });
      g.rect(controller.facing > 0 ? 2 : -6, -height + 8, 4, 4).fill({
        color: 0x0f172a,
      });
    });
  }
}

export class Player extends Entity {
  character!: PlatformerCharacter;
  ledge!: LedgeClimb;
  setup({
    nimble,
    canDash,
    position,
  }: {
    nimble: boolean;
    canDash: () => boolean;
    position: Vec2Like;
  }): void {
    this.add(new Transform({ position: new Vec2(position.x, position.y) }));
    this.character = createPlatformer(this, {
      // Omitting tuning uses every shipped movement default.
      ...(nimble
        ? {
            tuning: {
              runSpeed: 260,
              jumpSpeed: 480,
              airJumps: 2,
              dashCooldown: 0.3,
            },
          }
        : {}),
      collisionGroups: GROUND_GROUPS,
      collision: {
        solid: GROUND_GROUPS,
        volume: SOLID_GROUPS,
        wall: SOLID_GROUPS,
      },
      admissionPolicies: {
        canStartMove: (move) =>
          !this.ledge?.active && (move !== "dash" || canDash()),
      },
    });
    const probe = this.add(
      new LedgeProbe({
        tuning: {
          bodyWidth: 16,
          ledgeHandHeight: 32,
          ledgeGrabReach: 10,
          ledgeGrabTolerance: 12,
        },
        grab: SOLID_GROUPS,
        volume: SOLID_GROUPS,
      }),
    );
    this.ledge = this.add(new LedgeClimb(this.character, probe));
    const child = this.spawnChild("visual");
    child.add(new Transform());
    const visual = child.add(new GraphicsComponent({ layer: "player" }));
    child.add(new PlayerVisual(this.character, visual));
  }
}
