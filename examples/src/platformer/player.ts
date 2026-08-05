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
  private onGround = false;
  private coyoteTimer = 0; // seconds remaining
  private jumpBufferTimer = 0; // seconds remaining
  private dropPressed = false;
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
      snap: true, // open on the player rather than gliding in from (0, 0)
    });
    this.camera.bounds = {
      minX: 0,
      minY: 0,
      maxX: WORLD_W,
      maxY: WORLD_H,
    };
  }

  update(): void {
    if (isWon()) return;

    // Input edges are per-frame; capture them here and let fixedUpdate
    // consume them. A frame can run zero or two physics steps, so reading
    // isJustPressed there would drop or double-count a press.
    if (this.input.isJustPressed("jump")) {
      this.jumpBufferTimer = PlayerController.JUMP_BUFFER_SECONDS;
    }
    if (this.input.isJustPressed("down")) {
      this.dropPressed = true;
    }

    // -- Visual swap based on airborne state --
    const airborne = !this.onGround;
    if (airborne !== this.wasAirborne) {
      if (!airborne) this.audio.play(LandSfx.path, { channel: "sfx" });
      this.wasAirborne = airborne;
      this.redrawPlayer(airborne);
    }
  }

  // Movement runs on the physics cadence: velocities written here take
  // effect on the very next step, so the carry stays in step with the
  // platform's own fixedUpdate-authored motion instead of lagging a frame
  // behind it.
  fixedUpdate(dt: number): void {
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
    // Raycasts don't consult contact filters, so during a drop-through the
    // ray still reports the one-way platform being fallen through. It isn't
    // supporting the player, so it must not restore grounded state (and
    // with it the ability to jump mid-drop). Solid ground still counts.
    const passingThroughHit =
      this.collider.isDroppingThrough &&
      hit?.entity.tryGet(ColliderComponent)?.config.oneWay !== undefined;
    this.onGround = hit !== null && !passingThroughHit;

    if (this.onGround) {
      this.grounded = true;
      this.coyoteTimer = PlayerController.COYOTE_SECONDS;
    } else {
      this.coyoteTimer -= dt;
      if (this.coyoteTimer <= 0) {
        this.grounded = false;
      }
    }

    // -- Platform carrying: inherit velocity from the moving platform --
    let platformVelX = 0;
    let platformVelY = 0;
    if (this.onGround && hit) {
      const mover = hit.entity.tryGet(MovingPlatform);
      if (mover) {
        platformVelX = mover.velocity.x;
        // Track a descending platform. Contact pushes the player up when the
        // platform rises, but nothing pulls the player down when it turns
        // downward — without this the player free-falls after it and hangs
        // in the air at the top of the path.
        platformVelY = Math.max(mover.velocity.y, 0);
      }
    }

    // -- Drop through one-way platforms --
    if (this.dropPressed) {
      this.dropPressed = false;
      if (
        this.onGround &&
        hit?.entity.tryGet(ColliderComponent)?.config.oneWay
      ) {
        this.collider.dropThrough(0.25);
        this.grounded = false;
        this.coyoteTimer = 0;
      }
    }

    // -- Horizontal movement --
    // Analog stick wins when present; otherwise fall back to digital actions
    // (keyboard or D-pad) so all input devices feel snappy. These are state
    // reads, not edges, so they're safe on the fixed cadence.
    const stickX = this.input.getStick("left").x;
    let dx = stickX !== 0 ? stickX : this.input.getAxis("left", "right");

    // -- Wall detection: don't push into walls while airborne --
    if (dx !== 0 && !this.onGround) {
      const wallDir = dx > 0 ? Vec2.RIGHT : Vec2.LEFT;
      const wallHit = this.physicsWorld.raycast(
        pos,
        wallDir,
        PlayerController.WALL_RAY_DIST,
        { filterGroups },
      );
      if (wallHit) dx = 0;
    }

    // A jump below overwrites the vertical velocity, so tracking the
    // platform here never eats a jump.
    this.rb.setVelocity(
      new Vec2(
        dx * PlayerController.SPEED + platformVelX,
        Math.max(vel.y, platformVelY),
      ),
    );

    // -- Jump execution --
    if (this.jumpBufferTimer > 0 && this.grounded) {
      this.rb.setVelocityY(-PlayerController.JUMP_VELOCITY);
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.audio.play(JumpSfx.path, { channel: "sfx" });
    }
    this.jumpBufferTimer -= dt;
  }

  private redrawPlayer(airborne: boolean): void {
    const g = this.graphics.graphics;
    g.clear();
    drawPlayerGraphics(g, airborne);
  }
}

function drawPlayerGraphics(g: GraphicsContext, airborne: boolean): void {
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
