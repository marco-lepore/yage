/**
 * Save / Load example (v2 — auto-serialization)
 *
 * Demonstrates the @yagejs/save package:
 * - Components auto-serialize (Transform, RigidBody, Collider, Graphics)
 * - Entity afterRestore() only handles non-serializable gaps (draw calls, custom components)
 * - Scene afterRestore() handles scene-level state (GameState, event listeners)
 * - SaveService.saveData/loadData for persistent data (best score survives browser refresh)
 * - F5/F9 quicksave/load
 */

import {
  Engine,
  Scene,
  Entity,
  Component,
  Transform,
  Vec2,
  ServiceKey,
  serializable,
} from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  GraphicsContext,
  type LayerDef,
} from "@yagejs/renderer";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
  CollisionLayers,
  PhysicsWorldKey,
} from "@yagejs/physics";
import type { PhysicsWorld } from "@yagejs/physics";
import { SavePlugin, SaveServiceKey } from "@yagejs/save";
import type { SaveService } from "@yagejs/save";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, getContainer } from "./shared.js";

// ---------------------------------------------------------------------------
// Styles + HUD
// ---------------------------------------------------------------------------
injectStyles(`
  #hud {
    position: fixed; top: 1rem; right: 1rem;
    background: rgba(0,0,0,0.7); color: #ffe66d;
    font-family: monospace; font-size: 1rem;
    padding: 0.5rem 1rem; border-radius: 6px;
    pointer-events: none; line-height: 1.6;
  }
  #toast {
    position: fixed; bottom: 2rem; left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.85); color: #22c55e;
    font-family: monospace; font-size: 0.9rem;
    padding: 0.4rem 1.2rem; border-radius: 6px;
    pointer-events: none; opacity: 0;
    transition: opacity 0.2s;
  }
  #toast.show { opacity: 1; }
`);

const hud = document.createElement("div");
hud.id = "hud";
document.body.appendChild(hud);

const toast = document.createElement("div");
toast.id = "toast";
document.body.appendChild(toast);

let toastTimer = 0;
function showToast(msg: string) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1500);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 800;
const HEIGHT = 400;

const layers = new CollisionLayers();
const LAYER_PLAYER = layers.define("player");
const LAYER_SOLID = layers.define("solid");
const LAYER_COIN = layers.define("coin");
const LAYER_HAZARD = layers.define("hazard");

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------
function drawPlayer(g: GraphicsContext) {
  g.roundRect(-10, -16, 20, 32, 4).fill({ color: 0x22c55e });
  g.circle(-3, -10, 2).fill({ color: 0xffffff });
  g.circle(5, -10, 2).fill({ color: 0xffffff });
}

function drawCoin(g: GraphicsContext) {
  g.circle(0, 0, 8).fill({ color: 0xffe66d });
  g.circle(0, 0, 8).stroke({ color: 0xeab308, width: 2 });
}

function drawHazard(g: GraphicsContext) {
  g.poly([-10, 0, 0, -14, 10, 0]).fill({ color: 0xef4444 });
  g.poly([-10, 0, 0, -14, 10, 0]).stroke({ color: 0xb91c1c, width: 1 });
}

// ---------------------------------------------------------------------------
// Game state service
// ---------------------------------------------------------------------------
const GameStateKey = new ServiceKey<GameState>("gameState");

interface ProfileData {
  bestScore: number;
}

class GameState {
  coins = 0;
  hp = 3;
  bestScore: number;
  collectedCoinIds = new Set<string>();

  constructor(private saveService: SaveService) {
    const profile = saveService.loadData("profile") as ProfileData | null;
    this.bestScore = profile?.bestScore ?? 0;
  }

  collectCoin(id: string) {
    if (this.collectedCoinIds.has(id)) return;
    this.collectedCoinIds.add(id);
    this.coins++;
    if (this.coins > this.bestScore) {
      this.bestScore = this.coins;
      this.saveService.saveData("profile", {
        bestScore: this.bestScore,
      });
    }
  }

  takeDamage() {
    if (this.hp > 0) this.hp--;
  }

  serialize() {
    return {
      coins: this.coins,
      hp: this.hp,
      collectedCoinIds: [...this.collectedCoinIds],
    };
  }

  hydrate(data: { coins: number; hp: number; collectedCoinIds: string[] }) {
    this.coins = data.coins;
    this.hp = data.hp;
    this.collectedCoinIds = new Set(data.collectedCoinIds);
  }
}

// ---------------------------------------------------------------------------
// PlayerController — custom component (not auto-serializable)
// ---------------------------------------------------------------------------
class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private physics!: PhysicsWorld;
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly transform = this.sibling(Transform);
  private grounded = false;
  private coyoteTimer = 0;

  onAdd(): void {
    this.physics = this.use(PhysicsWorldKey);
  }

  update(dt: number) {
    const vel = this.rb.getVelocity();
    const pos = this.transform.position;

    const hit = this.physics.raycast(pos, Vec2.DOWN, 20, {
      filterGroups: CollisionLayers.interactionGroups(
        LAYER_PLAYER,
        LAYER_SOLID,
      ),
    });
    if (hit) {
      this.grounded = true;
      this.coyoteTimer = 80;
    } else {
      this.coyoteTimer -= dt;
      if (this.coyoteTimer <= 0) this.grounded = false;
    }

    const dx = this.input.getAxis("left", "right");
    this.rb.setVelocity({ x: dx * 200, y: vel.y });

    if (this.input.isJustPressed("jump") && this.grounded) {
      this.rb.setVelocityY(-420);
      this.grounded = false;
      this.coyoteTimer = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// MovingSpike — custom component with serializable state
// ---------------------------------------------------------------------------
@serializable
class MovingSpike extends Component {
  private readonly transform = this.sibling(Transform);
  elapsed = 0;
  constructor(
    private startX: number,
    private endX: number,
    private period: number,
  ) {
    super();
  }

  serialize() {
    return {
      startX: this.startX,
      endX: this.endX,
      period: this.period,
      elapsed: this.elapsed,
    };
  }

  static fromSnapshot(data: {
    startX: number;
    endX: number;
    period: number;
    elapsed: number;
  }): MovingSpike {
    const spike = new MovingSpike(data.startX, data.endX, data.period);
    spike.elapsed = data.elapsed;
    return spike;
  }

  update(dt: number) {
    if (this.period <= 0) return;
    this.elapsed += dt / 1000;
    const frac = (this.elapsed / this.period) % 1;
    const t = frac < 0.5 ? frac * 2 : 2 - frac * 2;
    const x = this.startX + (this.endX - this.startX) * t;
    this.transform.setPosition(x, this.transform.position.y);
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

@serializable
class PlayerEntity extends Entity {
  setup() {
    this.add(new Transform({ position: new Vec2(100, 300) }));
    this.add(new GraphicsComponent({ layer: "entities" }).draw(drawPlayer));
    this.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        ccd: true,
      }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: 20, height: 32 },
        friction: 0,
        layers: LAYER_PLAYER,
        mask: LAYER_SOLID | LAYER_COIN | LAYER_HAZARD,
      }),
    );
    this.add(new PlayerController());
  }

  // Only handles gaps: draw callback + custom component
  afterRestore() {
    this.get(GraphicsComponent).draw(drawPlayer);
    this.add(new PlayerController());
  }
}

@serializable
class CoinEntity extends Entity {
  coinId = "";

  setup(params: { id: string; x: number; y: number }) {
    this.coinId = params.id;
    this.buildStructure(params.x, params.y);
  }

  serialize() {
    return { coinId: this.coinId };
  }

  afterRestore(data: { coinId: string }) {
    this.coinId = data.coinId;
    this.get(GraphicsComponent).draw(drawCoin);
    this.setupTrigger();
  }

  private buildStructure(x: number, y: number) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new GraphicsComponent({ layer: "entities" }).draw(drawCoin));
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 8 },
        sensor: true,
        layers: LAYER_COIN,
        mask: LAYER_PLAYER,
      }),
    );
    this.setupTrigger();
  }

  private setupTrigger() {
    this.get(ColliderComponent).onTrigger((ev) => {
      if (ev.entered) {
        this.scene?.context.resolve(GameStateKey).collectCoin(this.coinId);
        this.destroy();
      }
    });
  }
}

@serializable
class HazardEntity extends Entity {
  private startX = 0;
  private endX = 0;
  private y = 0;
  private period = 0;

  setup(params: { startX: number; endX: number; y: number; period: number }) {
    Object.assign(this, params);
    this.buildStructure();
  }

  serialize() {
    return {
      startX: this.startX,
      endX: this.endX,
      y: this.y,
      period: this.period,
    };
  }

  afterRestore(data: {
    startX: number;
    endX: number;
    y: number;
    period: number;
  }) {
    Object.assign(this, data);
    this.get(GraphicsComponent).draw(drawHazard);
    // MovingSpike was auto-restored via fromSnapshot (registered in component registry)
    this.setupTrigger();
  }

  private buildStructure() {
    this.add(new Transform({ position: new Vec2(this.startX, this.y) }));
    this.add(new GraphicsComponent({ layer: "entities" }).draw(drawHazard));
    this.add(new RigidBodyComponent({ type: "kinematic" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: 20, height: 14 },
        sensor: true,
        layers: LAYER_HAZARD,
        mask: LAYER_PLAYER,
      }),
    );
    this.add(new MovingSpike(this.startX, this.endX, this.period));
    this.setupTrigger();
  }

  private setupTrigger() {
    this.get(ColliderComponent).onTrigger((ev) => {
      if (ev.entered) {
        this.scene?.context.resolve(GameStateKey).takeDamage();
      }
    });
  }
}

@serializable
class PlayerIndicator extends Entity {
  setup() {
    this.add(new Transform({ position: new Vec2(0, -28) }));
    this.add(
      new GraphicsComponent({ layer: "entities" }).draw((g) => {
        // Small downward arrow above the player
        g.poly([-5, -6, 0, 0, 5, -6]).fill({ color: 0x22c55e });
      }),
    );
  }

  afterRestore() {
    this.get(GraphicsComponent).draw((g) => {
      g.poly([-5, -6, 0, 0, 5, -6]).fill({ color: 0x22c55e });
    });
  }
}

// Wall — NOT serializable. Static geometry, rebuilt by scene.
class WallEntity extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }) {
    const { x, y, w, h } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "entities" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x334155 });
        g.rect(-w / 2, -h / 2, w, 2).fill({ color: 0x475569 });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        friction: 0,
        layers: LAYER_SOLID,
        mask: LAYER_PLAYER,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

type GameStateData = ReturnType<GameState["serialize"]>;

const COIN_POSITIONS = [
  { id: "c1", x: 200, y: 330 },
  { id: "c2", x: 350, y: 280 },
  { id: "c3", x: 500, y: 330 },
  { id: "c4", x: 650, y: 280 },
  { id: "c5", x: 720, y: 330 },
];

@serializable
class SaveDemoScene extends Scene {
  readonly name = "save-demo";
  readonly layers: readonly LayerDef[] = [
    { name: "bg", order: -10 },
    { name: "entities", order: 0 },
  ];
  private gs!: GameState;

  // ---- Fresh path ----
  onEnter() {
    this.buildShared();
    const player = this.spawn(PlayerEntity);
    const indicator = this.spawn(PlayerIndicator);
    player.addChild("indicator", indicator);
    for (const c of COIN_POSITIONS) this.spawn(CoinEntity, c);
    this.spawn(HazardEntity, { startX: 300, endX: 500, y: 360, period: 3 });
    this.spawn(HazardEntity, { startX: 550, endX: 700, y: 360, period: 2.5 });
  }

  serialize() {
    return { gs: this.gs.serialize() };
  }

  // ---- Restore path ----
  afterRestore(data: { gs: GameStateData }) {
    // Entities already auto-restored by save system.
    // Just handle scene-level state + listeners.
    this.buildShared();
    this.gs.hydrate(data.gs);
  }

  // ---- Shared setup (both paths) ----
  private buildShared() {
    const saveService = this.context.resolve(SaveServiceKey);
    this.gs = new GameState(saveService);
    this.context.unregister(GameStateKey);
    this.context.register(GameStateKey, this.gs);

    this.setupListeners();
    this.buildStaticGeometry();
  }

  private setupListeners() {
    // HUD update + quicksave/load via anonymous entity
    const gs = this.gs;
    const hudEntity = this.spawn("hud");
    hudEntity.add(new Transform());
    hudEntity.add(
      new (class extends Component {
        private readonly input = this.service(InputManagerKey);
        private readonly saveService = this.service(SaveServiceKey);

        update() {
          hud.innerHTML =
            `Coins: ${gs.coins} | HP: ${gs.hp}<br>` +
            `Best: ${gs.bestScore} (persisted)`;

          if (this.input.isJustPressed("quicksave")) {
            this.saveService.saveSnapshot("quick");
            showToast("Quicksaved!");
          }
          if (this.input.isJustPressed("quickload")) {
            if (!this.saveService.hasSnapshot("quick")) {
              showToast("No save found!");
              return;
            }
            this.saveService.loadSnapshot("quick").then(() => showToast("Quickloaded!"));
          }
        }
      })(),
    );
  }

  private buildStaticGeometry() {
    const bg = this.spawn("bg");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent({ layer: "bg" }).draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x0f172a });
        for (let x = 0; x <= WIDTH; x += 50) {
          g.moveTo(x, 0)
            .lineTo(x, HEIGHT)
            .stroke({ color: 0x1e293b, width: 1 });
        }
        for (let y = 0; y <= HEIGHT; y += 50) {
          g.moveTo(0, y).lineTo(WIDTH, y).stroke({ color: 0x1e293b, width: 1 });
        }
      }),
    );

    this.spawn(WallEntity, { x: WIDTH / 2, y: 385, w: WIDTH, h: 30 });
    this.spawn(WallEntity, { x: -5, y: HEIGHT / 2, w: 10, h: HEIGHT });
    this.spawn(WallEntity, { x: WIDTH + 5, y: HEIGHT / 2, w: 10, h: HEIGHT });
    this.spawn(WallEntity, { x: 300, y: 310, w: 120, h: 12 });
    this.spawn(WallEntity, { x: 550, y: 310, w: 120, h: 12 });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine();

  engine.use(new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0f172a,
    container: getContainer(),
  }));
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 800 } }));
  engine.use(new InputPlugin({
    actions: {
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      jump: ["Space"],
      quicksave: ["F5"],
      quickload: ["F9"],
    },
    preventDefaultKeys: ["Space", "F5", "F9"],
  }));
  engine.use(new SavePlugin());
  engine.use(new DebugPlugin());

  await engine.start();
  await engine.scenes.push(new SaveDemoScene());
}

main().catch(console.error);
