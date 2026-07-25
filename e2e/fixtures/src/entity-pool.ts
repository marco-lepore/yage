import {
  Engine,
  Component,
  Entity,
  EntityPool,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import { RendererPlugin, GraphicsComponent } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 640;
const HEIGHT = 480;
const container = setupContainer(WIDTH, HEIGHT);

const LIFETIME_FRAMES = 4;
const PER_FRAME = 2;
const CAP = 6;
/** Emission stops here, so the spec can watch every member go dormant. */
const EMIT_FRAMES = 20;

/** One pooled puff, named so the spec can find it through the Inspector. */
class Puff extends Entity {
  life = 0;
  acquires = 0;

  constructor() {
    super("puff");
  }

  setup(): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 8).fill({ color: 0x38bdf8 });
      }),
    );
  }

  onAcquire(x: number, y: number): void {
    this.life = LIFETIME_FRAMES;
    this.acquires++;
    this.get(Transform).setPosition(x, y);
  }

  override onRelease(): void {
    this.life = 0;
  }
}

/**
 * Drives the pool: takes `PER_FRAME` puffs every frame and gives each back
 * after `LIFETIME_FRAMES`. Demand outruns the cap, so `forceAcquire` reclaims.
 */
class Emitter extends Component {
  acquired = 0;
  reclaimed = 0;
  frame = 0;
  private pool!: EntityPool<Puff, number>;
  private live: Puff[] = [];

  onAdd(): void {
    this.pool = new EntityPool(this.scene, Puff, { maxSize: CAP, prewarm: 2 });
  }

  update(): void {
    this.frame++;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const puff = this.live[i]!;
      puff.life -= 1;
      if (puff.life > 0) continue;
      this.pool.release(puff);
      this.live.splice(i, 1);
    }
    if (this.frame > EMIT_FRAMES) return;
    for (let i = 0; i < PER_FRAME; i++) {
      const wasLive = this.pool.leased;
      const puff = this.pool.forceAcquire(
        40 + (this.acquired % 12) * 45,
        60 + (this.acquired % 7) * 40,
      );
      if (this.pool.leased === wasLive) this.reclaimed++;
      this.acquired++;
      const index = this.live.indexOf(puff);
      if (index !== -1) this.live.splice(index, 1);
      this.live.push(puff);
    }
  }

  /** Read by the spec through the Inspector's component reflection. */
  get poolSize(): number {
    return this.pool.size;
  }

  get leased(): number {
    return this.pool.leased;
  }

  get free(): number {
    return this.pool.free;
  }
}

class EntityPoolScene extends Scene {
  readonly name = "entity-pool";

  onEnter(): void {
    const emitter = this.spawn("emitter");
    emitter.add(new Transform({ position: new Vec2(0, 0) }));
    emitter.add(new Emitter());
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    container,
  }),
);
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new EntityPoolScene());
