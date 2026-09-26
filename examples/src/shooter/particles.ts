import { Component, Entity, RandomKey, Transform } from "@yagejs/core";
import {
  ParticleEmitterComponent,
  type BurstOverrides,
} from "@yagejs/particles";
import { BulletHit, EnemyKilled } from "./constants.js";

// ---------------------------------------------------------------------------
// ImpactSparks — particle bursts for bullet hits and enemy deaths
// ---------------------------------------------------------------------------

/** Radius of the largest spark in pixels. Smaller sparks scale it down. */
const SPARK_RADIUS = 3;

/** Directions within `spreadDeg` degrees centred on `angle` (radians). */
function spread(angle: number, spreadDeg: number): [number, number] {
  const half = (spreadDeg * Math.PI) / 360;
  return [angle - half, angle + half];
}

/** Blue sparks where a bullet hits a wall or a platform. */
const WALL_SPARKS: BurstOverrides = {
  tint: 0x38bdf8,
  speed: [80, 150],
  lifetime: [0.2, 0.35],
  scale: 2 / SPARK_RADIUS,
};

/** Red sparks where a bullet hits an enemy. */
const ENEMY_HIT_SPARKS: BurstOverrides = {
  tint: 0xef4444,
  angle: spread(Math.PI, 120),
  speed: [60, 120],
  lifetime: [0.25, 0.4],
  scale: 2.5 / SPARK_RADIUS,
};

/** A ring of crimson sparks where an enemy dies. */
const ENEMY_DEATH_SPARKS: BurstOverrides = {
  tint: 0xe11d48,
  angle: [0, Math.PI * 2],
  speed: [50, 200],
  lifetime: [0.3, 0.5],
  scale: 1,
};

/**
 * Listens for bullet hits and enemy deaths anywhere in the scene and bursts
 * sparks at the position the event carries. One emitter serves every burst;
 * each burst overrides its color, direction, speed and size.
 */
class ImpactSparks extends Component {
  private readonly emitter = this.sibling(ParticleEmitterComponent);
  private readonly random = this.service(RandomKey);

  onAdd(): void {
    this.listenScene(BulletHit, ({ x, y, dir, hitEnemy }) => {
      if (hitEnemy) {
        this.emitter.burst(this.random.int(4, 6), x, y, ENEMY_HIT_SPARKS);
        return;
      }
      // Sparks fly back out of the wall, toward the shooter.
      const normal = dir > 0 ? Math.PI : 0;
      this.emitter.burst(this.random.int(3, 5), x, y, {
        ...WALL_SPARKS,
        angle: spread(normal, 90),
      });
    });
    this.listenScene(EnemyKilled, ({ x, y }) => {
      this.emitter.burst(this.random.int(8, 12), x, y, ENEMY_DEATH_SPARKS);
    });
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
export class SparksEntity extends Entity {
  setup(): void {
    // `burst` takes world coordinates, so the emitter stays at the origin.
    this.add(new Transform());
    this.add(
      new ParticleEmitterComponent({
        shape: { type: "circle", size: SPARK_RADIUS * 2 },
        lifetime: [0.2, 0.5],
        alpha: { start: 1, end: 0 },
        layer: "world",
      }),
    );
    this.add(new ImpactSparks());
  }
}
