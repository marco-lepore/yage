import {
  Scene,
  Entity,
  Component,
  Transform,
  Vec2,
  EntityPool,
  globalRandom,
} from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  CameraEntity,
  type LayerDef,
} from "@yagejs/renderer";
import { RigidBodyComponent, ColliderComponent } from "@yagejs/physics";
import { InputManagerKey } from "@yagejs/input";

export const WIDTH = 900;
export const HEIGHT = 600;

const HUD_LAYER = "hud";
const SPARK_RADIUS = 5;
const SPARK_LIFETIME = 0.9;
const CAPPED_SIZE = 150;
const MIN_RATE = 1;
const MAX_RATE = 16;

/** Amber for the life a spark is built for, cyan for every reused life. */
const REUSED_TINT = 0x38bdf8;
const FRESH_TINT = 0xfbbf24;

/**
 * The short-lived entity this example churns through: a physics body plus a
 * display object, which is the pairing that costs the most to build.
 */
class Spark extends Entity {
  life = 0;
  private body!: RigidBodyComponent;
  private graphics!: GraphicsComponent;

  constructor() {
    super("spark");
  }

  setup(): void {
    this.add(new Transform());
    this.graphics = this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.circle(0, 0, SPARK_RADIUS).fill({ color: 0xffffff });
      }),
    );
    this.body = this.add(
      new RigidBodyComponent({ type: "dynamic", linearDamping: 0.05 }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: SPARK_RADIUS },
        restitution: 0.55,
        friction: 0.1,
        density: 1,
      }),
    );
  }

  /**
   * The per-reuse reset. A recycled spark still carries the position,
   * velocity, and colour of its last life, so every field the game reads has
   * to be written here.
   */
  onAcquire(x: number, y: number, vx: number, vy: number, tint: number): void {
    this.life = SPARK_LIFETIME;
    this.body.setPosition(x, y);
    this.body.setVelocity({ x: vx, y: vy });
    this.graphics.tint = tint;
  }

  override onRelease(): void {
    this.life = 0;
  }
}

/** Live counters the HUD reads. */
interface Stats {
  pooled: boolean;
  capped: boolean;
  rate: number;
  live: number;
  members: number;
  leased: number;
  free: number;
  fresh: number;
  reused: number;
  built: number;
  frameMs: number;
}

/**
 * Fires sparks at a fixed rate and takes them back when they expire, either
 * through a pool or by spawning and destroying one per shot.
 */
class Fountain extends Component {
  readonly stats: Stats = {
    pooled: true,
    capped: false,
    rate: 4,
    live: 0,
    members: 0,
    leased: 0,
    free: 0,
    fresh: 0,
    reused: 0,
    built: 0,
    frameMs: 0,
  };

  private readonly input = this.service(InputManagerKey);
  private elastic!: EntityPool<Spark>;
  private capped!: EntityPool<Spark, number>;
  private live: Spark[] = [];

  onAdd(): void {
    this.elastic = new EntityPool(this.scene, Spark);
    this.capped = new EntityPool(this.scene, Spark, { maxSize: CAPPED_SIZE });
  }

  update(dt: number): void {
    this.readInput();
    this.expire(dt);
    for (let i = 0; i < this.stats.rate; i++) this.fire();
    this.publish(dt);
  }

  private readInput(): void {
    if (this.input.isJustPressed("toggleMode")) {
      this.recallAll();
      this.stats.pooled = !this.stats.pooled;
    }
    if (this.input.isJustPressed("toggleCap")) {
      this.recallAll();
      this.stats.capped = !this.stats.capped;
    }
    if (this.input.isJustPressed("rateUp")) {
      this.stats.rate = Math.min(MAX_RATE, this.stats.rate + 1);
    }
    if (this.input.isJustPressed("rateDown")) {
      this.stats.rate = Math.max(MIN_RATE, this.stats.rate - 1);
    }
  }

  /** Take every spark back, so the two modes always start from an empty field. */
  private recallAll(): void {
    for (const spark of this.live) this.retire(spark);
    this.live.length = 0;
  }

  private expire(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const spark = this.live[i]!;
      spark.life -= dt;
      const transform = spark.get(Transform);
      if (spark.life > 0 && transform.worldPosition.y < HEIGHT + 60) continue;
      this.retire(spark);
      const last = this.live.pop()!;
      if (last !== spark) this.live[i] = last;
    }
  }

  private fire(): void {
    const angle = -Math.PI / 2 + globalRandom.range(-0.5, 0.5);
    const speed = globalRandom.range(420, 700);
    const x = WIDTH / 2 + globalRandom.range(-8, 8);
    const y = HEIGHT - 60;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    if (!this.stats.pooled) {
      // The path pooling replaces: a fresh entity per shot, destroyed when it
      // expires. Every spawn rebuilds a Rapier body and a Pixi Graphics.
      const spark = this.scene.spawn(Spark);
      spark.onAcquire(x, y, vx, vy, FRESH_TINT);
      this.stats.built++;
      this.stats.fresh++;
      this.live.push(spark);
      return;
    }

    const pool = this.stats.capped ? this.capped : this.elastic;
    const capacity = this.stats.capped ? CAPPED_SIZE : Number.POSITIVE_INFINITY;
    const outOfMembers = pool.free === 0;
    const fresh = outOfMembers && pool.size < capacity;
    // On the capped pool `forceAcquire` recycles the oldest spark still in
    // flight once every member is out; on the elastic one it just grows.
    const spark = pool.forceAcquire(
      x,
      y,
      vx,
      vy,
      fresh ? FRESH_TINT : REUSED_TINT,
    );
    if (fresh) {
      this.stats.built++;
      this.stats.fresh++;
    } else {
      this.stats.reused++;
    }
    if (outOfMembers && !fresh) {
      // Reclaimed mid-flight, so it is still in `live` from its last life.
      const index = this.live.indexOf(spark);
      if (index !== -1) this.live.splice(index, 1);
    }
    this.live.push(spark);
  }

  private retire(spark: Spark): void {
    // One line for both modes: a pooled spark goes back to its pool, a
    // spawned one is destroyed. The retire site never learns which.
    spark.destroy();
  }

  private publish(dt: number): void {
    const pool = this.stats.capped ? this.capped : this.elastic;
    this.stats.live = this.live.length;
    this.stats.members = pool.size;
    this.stats.leased = pool.leased;
    this.stats.free = pool.free;
    // Smoothed so the readout is legible rather than jittering every frame.
    this.stats.frameMs += (dt * 1000 - this.stats.frameMs) * 0.1;
  }
}

/** Draws the counters on the screen-space layer, next to the controls. */
class StatsHud extends Component {
  private readonly fountain = this.sibling(Fountain);
  private text!: TextComponent;

  onAdd(): void {
    this.text = this.entity.get(TextComponent);
  }

  update(): void {
    const s = this.fountain.stats;
    const mode = s.pooled
      ? `POOLED (${s.capped ? `capped at ${CAPPED_SIZE}` : "elastic"})`
      : "SPAWN + DESTROY";
    const fps = s.frameMs > 0 ? Math.round(1000 / s.frameMs) : 0;
    this.text.setText(
      [
        `mode          ${mode}`,
        `sparks live   ${s.live}   (${s.rate} per frame)`,
        `pool          ${s.members} members — ${s.leased} leased / ${s.free} free`,
        `acquires      ${s.fresh} fresh / ${s.reused} reused`,
        `entities made ${s.built}`,
        `frame         ${s.frameMs.toFixed(1)} ms (${fps} fps)`,
      ].join("\n"),
    );
  }
}

export class PoolingScene extends Scene {
  readonly name = "pooling";

  readonly layers: readonly LayerDef[] = [
    { name: "world", order: 0 },
    { name: HUD_LAYER, order: 1000, space: "screen" },
  ];

  onEnter(): void {
    // Centred on the canvas so the world layer sits at the identity — the
    // fountain is authored in screen-sized coordinates and never scrolls.
    this.spawn(CameraEntity, { position: new Vec2(WIDTH / 2, HEIGHT / 2) });
    this.buildWalls();

    const fountain = this.spawn("fountain");
    fountain.add(new Transform({ position: new Vec2(16, 14) }));
    fountain.add(
      new TextComponent({
        text: "",
        anchor: { x: 0, y: 0 },
        style: {
          fontFamily: "monospace",
          fontSize: 15,
          fill: 0xe2e8f0,
          lineHeight: 21,
        },
        layer: HUD_LAYER,
      }),
    );
    fountain.add(new Fountain());
    fountain.add(new StatsHud());
  }

  private buildWalls(): void {
    this.wall(WIDTH / 2, HEIGHT - 10, WIDTH, 20);
    this.wall(-10, HEIGHT / 2, 20, HEIGHT);
    this.wall(WIDTH + 10, HEIGHT / 2, 20, HEIGHT);
  }

  private wall(x: number, y: number, w: number, h: number): void {
    const wall = this.spawn("wall");
    wall.add(new Transform({ position: new Vec2(x, y) }));
    wall.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x334155 });
      }),
    );
    wall.add(new RigidBodyComponent({ type: "static" }));
    wall.add(
      new ColliderComponent({ shape: { type: "box", width: w, height: h } }),
    );
  }
}
