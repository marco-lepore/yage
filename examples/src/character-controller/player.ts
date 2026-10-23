import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  type Vec2Like,
} from "@yagejs/core";
import { GraphicsComponent, type CameraEntity } from "@yagejs/renderer";
import {
  createPlatformer,
  defaultPlatformerTuning,
  LedgeProbe,
  type PlatformerCharacter,
  type PlatformerConfig,
} from "@yagejs-addons/character-controller";
import { COLORS } from "./constants.js";
import type { Playground } from "./hud.js";
import { LedgeClimb } from "./ledge.js";

/** Draws the body from the character's state: its height, facing, and current move. */
class PlayerVisual extends Component {
  private readonly graphics = this.sibling(GraphicsComponent);
  /** The state last drawn, so the shape is rebuilt only when it changes. */
  private drawn = "";

  constructor(
    private readonly character: PlatformerCharacter,
    private readonly ledge: LedgeClimb,
    private readonly config: Readonly<PlatformerConfig>,
  ) {
    super();
  }

  update(): void {
    const { controller, stance, moves } = this.character;
    const { bodyWidth, bodyHeight, crouchHeight } = this.config;
    const height = stance.crouched ? crouchHeight : bodyHeight;
    const color = this.ledge.active
      ? COLORS.moving
      : moves.dashing
        ? COLORS.dash
        : COLORS.player;
    const state = `${height}:${color}:${controller.facing}`;
    if (state === this.drawn) return;
    this.drawn = state;
    this.graphics.draw((g) => {
      g.clear();
      g.roundRect(-bodyWidth / 2, -height, bodyWidth, height, 4).fill({
        color,
      });
      g.rect(controller.facing > 0 ? 2 : -6, -height + 8, 4, 4).fill({
        color: 0x0f172a,
      });
    });
  }
}

/** The playground's character: the addon's default platformer plus the example's ledge move. */
export class PlayerEntity extends Entity {
  /** Every movement number, the preset's overrides applied to the defaults. */
  config!: Readonly<PlatformerConfig>;
  character!: PlatformerCharacter;
  ledge!: LedgeClimb;

  setup({
    position,
    tuning,
    playground,
    camera,
  }: {
    position: Vec2Like;
    tuning: Partial<PlatformerConfig>;
    playground: Playground;
    camera: CameraEntity;
  }): void {
    this.add(new Transform({ position: new Vec2(position.x, position.y) }));
    this.add(new GraphicsComponent({ layer: "player" }));
    this.add(new ProcessComponent());
    this.config = defaultPlatformerTuning(tuning);
    // The feet are the origin. createPlatformer adds a dynamic body, a box
    // collider sized from the tuning, the default input binding, and every move.
    this.character = createPlatformer(this, {
      tuning: this.config,
      admissionPolicies: {
        // Game rules decide when a move may start: none while on a ledge,
        // and no dash while the playground blocks dashes.
        canStartMove: (move) =>
          !this.ledge.active && (move !== "dash" || playground.dashAllowed),
      },
    });
    const probe = this.add(
      new LedgeProbe({
        tuning: {
          ledgeHandHeight: 32,
          ledgeGrabReach: 10,
          ledgeGrabTolerance: 12,
        },
      }),
    );
    this.ledge = this.add(new LedgeClimb(this.character, probe));
    this.add(new PlayerVisual(this.character, this.ledge, this.config));
    camera.follow(this, {
      offset: { x: 120, y: 0 },
      smoothing: 0.12,
      snap: true,
    });
  }
}
