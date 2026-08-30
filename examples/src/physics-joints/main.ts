import { Component, Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
} from "@yagejs/renderer";
import {
  ColliderComponent,
  PhysicsPlugin,
  PhysicsWorldKey,
  RigidBodyComponent,
} from "@yagejs/physics";
import type { JointHandle, PhysicsWorld } from "@yagejs/physics";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

const WIDTH = 800;
const HEIGHT = 600;
const WALL = 20;
const PLAYER_START = { x: 240, y: 220 };
const COMPANION_START = { x: 320, y: 220 };
/** Where the scene ropes the player on load, so it swings before any input. */
const INITIAL_ANCHOR = { x: 400, y: 120 };
const MIN_GRAPPLE_LENGTH = 40;
const ROPE_COLOR = 0xfacc15;
const ELASTIC_COLOR = 0x4ade80;
const TETHER_COLOR = 0xf472b6;

type GrappleMode = "rope" | "elastic";

interface GrappleAnchor {
  rb: RigidBodyComponent;
  transform: Transform;
  graphics: GraphicsComponent;
}

class GrappleController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly player: RigidBodyComponent;
  private readonly companion: RigidBodyComponent;
  private world!: PhysicsWorld;
  private grapple: JointHandle | undefined;
  private anchor: GrappleAnchor | undefined;
  private offPointerDown: (() => void) | undefined;
  private mode: GrappleMode = "rope";
  private modeText: TextComponent | undefined;

  constructor(player: RigidBodyComponent, companion: RigidBodyComponent) {
    super();
    this.player = player;
    this.companion = companion;
  }

  override onAdd(): void {
    this.world = this.use(PhysicsWorldKey);
    this.offPointerDown = this.input.onPointerDown((pointer) => {
      if (pointer.button === 0) this.grappleAt(pointer.screenPos);
    });

    const hud = this.scene.spawn("grapple-hud");
    hud.add(new Transform({ position: new Vec2(16, 12) }));
    this.modeText = hud.add(
      new TextComponent({
        text: "",
        style: { fontFamily: "monospace", fontSize: 16, fill: ROPE_COLOR },
      }),
    );
    this.updateModeText();

    // Start attached and off to the side, so the page opens on a swing
    // instead of two balls dropping to the floor.
    this.grappleAt(new Vec2(INITIAL_ANCHOR.x, INITIAL_ANCHOR.y));
  }

  override onDestroy(): void {
    this.offPointerDown?.();
    this.offPointerDown = undefined;
    this.grapple?.remove();
    this.grapple = undefined;
  }

  override update(): void {
    if (this.input.isJustPressed("toggle")) this.toggleMode();
    if (this.input.isJustPressed("release")) this.releaseGrapple();
    if (this.input.isJustPressed("reset")) this.reset();
  }

  get anchorPosition(): Vec2 | undefined {
    return this.anchor?.rb.position;
  }

  get isGrappled(): boolean {
    return this.grapple?.attached ?? false;
  }

  get grappleColor(): number {
    return this.mode === "rope" ? ROPE_COLOR : ELASTIC_COLOR;
  }

  private grappleAt(position: Vec2): void {
    this.grapple?.remove();

    const anchor = (this.anchor ??= this.createAnchor(position));
    anchor.transform.setPosition(position.x, position.y);
    anchor.rb.setPosition(position.x, position.y);
    const dist = Math.max(
      MIN_GRAPPLE_LENGTH,
      Math.hypot(
        this.player.positionX - position.x,
        this.player.positionY - position.y,
      ),
    );
    this.grapple =
      this.mode === "rope"
        ? this.world.addJoint(this.player, anchor.rb, {
            type: "rope",
            length: dist,
          })
        : this.world.addJoint(this.player, anchor.rb, {
            // Rest length below the current distance, so the bungee starts
            // pulling the moment it attaches.
            type: "spring",
            restLength: Math.max(MIN_GRAPPLE_LENGTH, dist * 0.55),
            stiffness: 25,
            damping: 1.5,
          });
    anchor.graphics.visible = true;
  }

  /** Switch rope/elastic; a live grapple is converted at its anchor. */
  private toggleMode(): void {
    this.mode = this.mode === "rope" ? "elastic" : "rope";
    this.updateModeText();
    if (this.anchor && this.isGrappled) {
      this.grappleAt(this.anchor.rb.position);
    }
  }

  private updateModeText(): void {
    this.modeText?.setText(`grapple: ${this.mode} — E switches`);
    this.modeText?.mergeStyle({ fill: this.grappleColor });
  }

  private reset(): void {
    this.player.setPosition(PLAYER_START.x, PLAYER_START.y);
    this.player.setVelocity({ x: 0, y: 0 });
    this.companion.setPosition(COMPANION_START.x, COMPANION_START.y);
    this.companion.setVelocity({ x: 0, y: 0 });
    this.grappleAt(new Vec2(INITIAL_ANCHOR.x, INITIAL_ANCHOR.y));
  }

  private createAnchor(position: Vec2): GrappleAnchor {
    const entity = this.scene.spawn("grapple-anchor");
    const transform = entity.add(new Transform({ position }));
    const graphics = entity.add(
      new GraphicsComponent({ visible: false }).draw((g) => {
        g.circle(0, 0, 8).fill({ color: 0xfacc15, alpha: 0.9 });
        g.circle(0, 0, 12).stroke({ color: 0xfff7ae, width: 2 });
      }),
    );
    const rb = entity.add(new RigidBodyComponent({ type: "static" }));
    return { rb, transform, graphics };
  }

  private releaseGrapple(): void {
    this.grapple?.remove();
    this.grapple = undefined;
    if (this.anchor) this.anchor.graphics.visible = false;
  }
}

class ConnectionGraphics extends Component {
  private readonly graphics = this.sibling(GraphicsComponent);
  private readonly player: RigidBodyComponent;
  private readonly companion: RigidBodyComponent;
  private readonly controller: GrappleController;

  constructor(
    player: RigidBodyComponent,
    companion: RigidBodyComponent,
    controller: GrappleController,
  ) {
    super();
    this.player = player;
    this.companion = companion;
    this.controller = controller;
  }

  override update(): void {
    const player = this.player.position;
    const companion = this.companion.position;
    const anchor = this.controller.anchorPosition;

    this.graphics.draw((g) => {
      g.clear();
      g.moveTo(player.x, player.y).lineTo(companion.x, companion.y).stroke({
        color: TETHER_COLOR,
        width: 3,
        alpha: 0.85,
      });
      if (anchor && this.controller.isGrappled) {
        g.moveTo(player.x, player.y).lineTo(anchor.x, anchor.y).stroke({
          color: this.controller.grappleColor,
          width: 3,
          alpha: 0.9,
        });
      }
    });
  }
}

class PhysicsJointsScene extends Scene {
  readonly name = "physics-joints";

  onEnter(): void {
    this.createWall(WIDTH / 2, HEIGHT - WALL / 2, WIDTH, WALL, 0x444444);
    this.createWall(WALL / 2, HEIGHT / 2, WALL, HEIGHT, 0x333333);
    this.createWall(WIDTH - WALL / 2, HEIGHT / 2, WALL, HEIGHT, 0x333333);

    const player = this.createBall(
      "player",
      PLAYER_START.x,
      PLAYER_START.y,
      18,
      0x38bdf8,
    );
    const companion = this.createBall(
      "companion",
      COMPANION_START.x,
      COMPANION_START.y,
      12,
      0xf472b6,
    );
    const world = this.use(PhysicsWorldKey);
    world.addJoint(player, companion, {
      type: "spring",
      restLength: 80,
      stiffness: 40,
      damping: 4,
    });

    const controllerEntity = this.spawn("grapple-controller");
    controllerEntity.add(new Transform());
    const controller = controllerEntity.add(
      new GrappleController(player, companion),
    );

    const connections = this.spawn("connections");
    connections.add(new Transform());
    connections.add(new GraphicsComponent());
    connections.add(new ConnectionGraphics(player, companion, controller));
  }

  private createBall(
    name: string,
    x: number,
    y: number,
    radius: number,
    color: number,
  ): RigidBodyComponent {
    const entity = this.spawn(name);
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, radius).fill({ color, alpha: 0.9 });
        g.circle(0, 0, radius).stroke({ color: 0xffffff, width: 2 });
      }),
    );
    const rb = entity.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        ccd: true,
      }),
    );
    entity.add(
      new ColliderComponent({
        shape: { type: "circle", radius },
        restitution: 0.25,
        friction: 0.4,
      }),
    );
    return rb;
  }

  private createWall(
    x: number,
    y: number,
    width: number,
    height: number,
    color: number,
  ): void {
    const entity = this.spawn("wall");
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-width / 2, -height / 2, width, height).fill({ color });
      }),
    );
    entity.add(new RigidBodyComponent({ type: "static" }));
    entity.add(
      new ColliderComponent({
        shape: { type: "box", width, height },
        restitution: 0.3,
        friction: 0.5,
      }),
    );
  }
}

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new PhysicsPlugin());
  engine.use(
    new InputPlugin({
      actions: {
        toggle: ["KeyE"],
        release: ["Space"],
        reset: ["KeyR"],
      },
      preventDefaultKeys: ["Space"],
    }),
  );
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new PhysicsJointsScene());
}

main().catch(console.error);
