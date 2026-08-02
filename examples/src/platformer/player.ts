import { Entity, Component, Transform, Vec2 } from "@yagejs/core";
import {
  GraphicsComponent,
  type CameraEntity,
  type GraphicsContext,
} from "@yagejs/renderer";
import {
  RigidBodyComponent,
  ColliderComponent,
  CollisionLayers,
  PhysicsWorldKey,
} from "@yagejs/physics";
import type { PhysicsWorld } from "@yagejs/physics";
import { AudioManagerKey } from "@yagejs/audio";
import { InputManagerKey } from "@yagejs/input";
import {
  SPAWN,
  WORLD_W,
  WORLD_H,
  LAYER_PLAYER,
  LAYER_PLATFORM,
  LAYER_COIN,
  LAYER_GOAL,
  LAYER_DEATH,
  JumpSfx,
  LandSfx,
} from "./constants.js";
import { MovingPlatform } from "./level.js";
import { isWon } from "./hud.js";

// ---------------------------------------------------------------------------
// PlayerController
// ---------------------------------------------------------------------------
class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly camera: CameraEntity;
  private physicsWorld!: PhysicsWorld;
  private readonly audio = this.service(AudioManagerKey);
  private readonly graphics = this.sibling(GraphicsComponent);
  private readonly transform = this.sibling(Transform);
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly collider = this.sibling(ColliderComponent);

  constructor(camera: CameraEntity) {
    super();
    this.camera = camera;
  }

  private grounded = false;
  private coyoteTimer = 0; // seconds remaining
  private jumpBufferTimer = 0; // seconds remaining
  private wasAirborne = false;

  private static readonly SPEED = 220;
  private static readonly JUMP_VELOCITY = 505;
  private static readonly COYOTE_SECONDS = 0.1;
  private static readonly JUMP_BUFFER_SECONDS = 0.12;
  private static readonly GROUND_RAY_DIST = 22;
  private static readonly WALL_RAY_DIST = 16;

  onAdd(): void {
    this.physicsWorld = this.use(PhysicsWorldKey);

    // Camera follow
    this.camera.follow(this.transform, {
      smoothing: 0.12,
      offset: new Vec2(0, -60),
      deadzone: { halfWidth: 60, halfHeight: 40 },
    });
    this.camera.bounds = {
      minX: 0,
      minY: 0,
      maxX: WORLD_W,
      maxY: WORLD_H,
    };
  }

  update(dt: number): void {
    if (isWon()) return;

    const vel = this.rb.getVelocity();

    // -- Ground detection via raycast --
    const pos = this.transform.position;
    const filterGroups = CollisionLayers.interactionGroups(
      LAYER_PLAYER,
      LAYER_PLATFORM,
    );
    const hit = this.physicsWorld.raycast(
      pos,
      Vec2.DOWN,
      PlayerController.GROUND_RAY_DIST,
      { filterGroups },
    );
    const onGround = hit !== null;

    if (onGround) {
      this.grounded = true;
      this.coyoteTimer = PlayerController.COYOTE_SECONDS;
    } else {
      this.coyoteTimer -= dt;
      if (this.coyoteTimer <= 0) {
        this.grounded = false;
      }
    }

    // -- Platform carrying: inherit horizontal velocity from moving platform --
    let platformVelX = 0;
    if (hit) {
      const mover = hit.entity.tryGet(MovingPlatform);
      if (mover) platformVelX = mover.velocity.x;
    }

    // -- Drop through one-way platforms --
    if (
      this.input.isJustPressed("down") &&
      onGround &&
      hit?.entity.tryGet(ColliderComponent)?.config.oneWay
    ) {
      this.collider.dropThrough(0.25);
      this.grounded = false;
      this.coyoteTimer = 0;
    }

    // -- Horizontal movement --
    // Analog stick wins when present; otherwise fall back to digital actions
    // (keyboard or D-pad) so all input devices feel snappy.
    const stickX = this.input.getStick("left").x;
    let dx = stickX !== 0 ? stickX : this.input.getAxis("left", "right");

    // -- Wall detection: don't push into walls while airborne --
    if (dx !== 0 && !onGround) {
      const wallDir = dx > 0 ? Vec2.RIGHT : Vec2.LEFT;
      const wallHit = this.physicsWorld.raycast(
        pos,
        wallDir,
        PlayerController.WALL_RAY_DIST,
        { filterGroups },
      );
      if (wallHit) dx = 0;
    }

    this.rb.setVelocity(
      new Vec2(dx * PlayerController.SPEED + platformVelX, vel.y),
    );

    // -- Jump buffering --
    if (this.input.isJustPressed("jump")) {
      this.jumpBufferTimer = PlayerController.JUMP_BUFFER_SECONDS;
    } else {
      this.jumpBufferTimer -= dt;
    }

    // -- Jump execution --
    if (this.jumpBufferTimer > 0 && this.grounded) {
      this.rb.setVelocityY(-PlayerController.JUMP_VELOCITY);
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.audio.play(JumpSfx.path, { channel: "sfx" });
    }

    // -- Visual swap based on airborne state --
    const airborne = !onGround;
    if (airborne !== this.wasAirborne) {
      if (!airborne) this.audio.play(LandSfx.path, { channel: "sfx" });
      this.wasAirborne = airborne;
      this.redrawPlayer(airborne);
    }
  }

  private redrawPlayer(airborne: boolean): void {
    const g = this.graphics.graphics;
    g.clear();
    drawPlayerGraphics(g, airborne);
  }
}

function drawPlayerGraphics(
  g: GraphicsContext,
  airborne: boolean,
): void {
  const bodyColor = airborne ? 0x38bdf8 : 0x22c55e;
  const outlineColor = airborne ? 0x0ea5e9 : 0x16a34a;
  // Body
  g.rect(-12, -18, 24, 36).fill({ color: bodyColor });
  g.rect(-12, -18, 24, 36).stroke({ color: outlineColor, width: 2 });
  // Eyes
  g.circle(-4, -10, 2.5).fill({ color: 0xffffff });
  g.circle(4, -10, 2.5).fill({ color: 0xffffff });
  g.circle(-4, -10, 1.2).fill({ color: 0x111111 });
  g.circle(4, -10, 1.2).fill({ color: 0x111111 });
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
export class PlayerEntity extends Entity {
  setup(params: { camera: CameraEntity }): void {
    this.add(new Transform({ position: new Vec2(SPAWN.x, SPAWN.y) }));
    this.add(
      new GraphicsComponent({ layer: "player" }).draw((g) => {
        drawPlayerGraphics(g, false);
      }),
    );
    this.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        ccd: true,
      }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: 24, height: 36 },
        friction: 0,
        layers: LAYER_PLAYER,
        mask: LAYER_PLATFORM | LAYER_COIN | LAYER_GOAL | LAYER_DEATH,
      }),
    );
    this.add(new PlayerController(params.camera));
  }
}
