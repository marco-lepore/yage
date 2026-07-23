import { Entity, Component, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { RigidBodyComponent, ColliderComponent } from "@yagejs/physics";
import {
  LAYER_PLAYER,
  LAYER_PLATFORM,
  LAYER_COIN,
  LAYER_GOAL,
  LAYER_DEATH,
  CoinCollected,
  PlayerDied,
  GoalReached,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Triangle wave for ping-pong lerp: 0→1→0→1…
// ---------------------------------------------------------------------------
function triangleWave(t: number): number {
  const frac = t - Math.floor(t);
  return frac < 0.5 ? frac * 2 : 2 - frac * 2;
}

// ---------------------------------------------------------------------------
// MovingPlatform — kinematic body ping-ponging between two positions
// ---------------------------------------------------------------------------
export class MovingPlatform extends Component {
  private startPos: Vec2;
  private endPos: Vec2;
  private period: number; // seconds for full cycle
  private elapsed = 0;
  private prevPos: Vec2;
  private readonly transform = this.sibling(Transform);

  /** Platform velocity in px/s, readable by PlayerController. */
  velocity: Vec2 = Vec2.ZERO;

  constructor(startPos: Vec2, endPos: Vec2, period: number) {
    super();
    this.startPos = startPos;
    this.endPos = endPos;
    this.period = period;
    this.prevPos = new Vec2(startPos.x, startPos.y);
  }

  update(dt: number): void {
    this.elapsed += dt;
    const t = triangleWave(this.elapsed / this.period);
    const pos = this.startPos.lerp(this.endPos, t);
    this.transform.setPosition(pos.x, pos.y);

    if (dt > 0) {
      this.velocity = new Vec2(
        (pos.x - this.prevPos.x) / dt,
        (pos.y - this.prevPos.y) / dt,
      );
    }
    this.prevPos = pos;
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
export class PlatformEntity extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x475569 });
        // Top surface highlight
        g.rect(-w / 2, -h / 2, w, 3).fill({ color: 0x64748b });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        friction: 0,
        layers: LAYER_PLATFORM,
        mask: LAYER_PLAYER,
      }),
    );
  }
}

export class MovingPlatformEntity extends Entity {
  setup(params: {
    start: Vec2;
    end: Vec2;
    w: number;
    h: number;
    period: number;
  }): void {
    const { start, end, w, h, period } = params;
    this.add(new Transform({ position: new Vec2(start.x, start.y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x7c3aed });
        // Top surface highlight
        g.rect(-w / 2, -h / 2, w, 3).fill({ color: 0xa78bfa });
        // Movement arrows
        g.circle(0, 0, 3).fill({ color: 0xa78bfa, alpha: 0.5 });
      }),
    );
    this.add(new RigidBodyComponent({ type: "kinematic" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        friction: 0,
        layers: LAYER_PLATFORM,
        mask: LAYER_PLAYER,
      }),
    );
    this.add(new MovingPlatform(start, end, period));
  }
}

export class CoinEntity extends Entity {
  setup(params: { x: number; y: number }): void {
    const { x, y } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.circle(0, 0, 10).fill({ color: 0xffe66d });
        g.circle(0, 0, 10).stroke({ color: 0xeab308, width: 2 });
        g.circle(0, 0, 4).fill({ color: 0xeab308, alpha: 0.6 });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static", fixedRotation: true }));
    const collider = new ColliderComponent({
      shape: { type: "circle", radius: 10 },
      sensor: true,
      layers: LAYER_COIN,
      mask: LAYER_PLAYER,
    });
    this.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        this.emit(CoinCollected);
        this.destroy();
      }
    });
  }
}

export class DeathZoneEntity extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0xef4444, alpha: 0.3 });
        // Hazard stripes
        for (let i = -w / 2; i < w / 2; i += 12) {
          g.moveTo(i, -h / 2)
            .lineTo(i + 6, h / 2)
            .stroke({ color: 0xef4444, width: 1, alpha: 0.4 });
        }
      }),
    );
    this.add(new RigidBodyComponent({ type: "static", fixedRotation: true }));
    const collider = new ColliderComponent({
      shape: { type: "box", width: w, height: h },
      sensor: true,
      layers: LAYER_DEATH,
      mask: LAYER_PLAYER,
    });
    this.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        this.emit(PlayerDied);
      }
    });
  }
}

export class GoalEntity extends Entity {
  setup(params: { x: number; y: number }): void {
    const { x, y } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        // Flag pole
        g.rect(-2, -50, 4, 60).fill({ color: 0x94a3b8 });
        // Flag
        g.poly([2, -50, 30, -40, 2, -30]).fill({ color: 0x22c55e });
        // Base
        g.rect(-10, 8, 20, 4).fill({ color: 0x64748b });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static", fixedRotation: true }));
    const collider = new ColliderComponent({
      shape: { type: "box", width: 30, height: 60 },
      sensor: true,
      layers: LAYER_GOAL,
      mask: LAYER_PLAYER,
    });
    this.add(collider);

    collider.onTrigger((ev) => {
      if (ev.entered) {
        this.emit(GoalReached);
      }
    });
  }
}
