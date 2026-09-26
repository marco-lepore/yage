import { Component, Entity, Transform, type Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { Feel } from "@yagejs-addons/feel";
import {
  damageImpact,
  dashBurst,
  enemyDeath,
  impact,
  spawnPop,
} from "@yagejs-addons/feel/recipes";
import { FeelDemo, type ShowcaseDemo } from "./gallery.js";

// ---------------------------------------------------------------------------
// 1  Recipe: impact
// ---------------------------------------------------------------------------

export class ImpactRecipeDemo extends FeelDemo {
  readonly label = "impact recipe";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 47).fill({ color: 0x7f1d1d });
        g.circle(0, 0, 31).fill({ color: 0xdc2626 });
        g.poly([0, -24, 8, -8, 26, 0, 8, 8, 0, 25, -8, 8, -26, 0, -8, -8]).fill(
          { color: 0xfef2f2 },
        );
      }),
    );
    this.add(
      new Feel({
        show: impact({
          target: visual,
          color: 0xfca5a5,
          scale: 1.22,
          shake: 5,
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 2  Recipe: damage impact
// ---------------------------------------------------------------------------

export class DamageImpactRecipeDemo extends FeelDemo {
  readonly label = "damage impact recipe";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(-47, -42, 94, 84, 18).fill({ color: 0x1e3a8a });
        g.circle(-18, -6, 8).fill({ color: 0xbfdbfe });
        g.circle(18, -6, 8).fill({ color: 0xbfdbfe });
        g.moveTo(-21, 20)
          .quadraticCurveTo(0, 8, 21, 20)
          .stroke({ color: 0x93c5fd, width: 5 });
      }),
    );
    this.add(
      new Feel({
        show: damageImpact({
          target: visual,
          value: 42,
          critical: true,
          impact: { color: 0xfbbf24, shake: 6 },
          number: { suffix: "!", criticalColor: 0xfde047 },
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 3  Recipe: dash burst
// ---------------------------------------------------------------------------

export class DashBurstRecipeDemo extends FeelDemo {
  readonly label = "dash burst recipe";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.poly([-44, -28, 18, -28, 48, 0, 18, 28, -44, 28, -19, 0]).fill({
          color: 0x0891b2,
        });
        g.poly([-20, -14, 12, -14, 29, 0, 12, 14, -20, 14, -7, 0]).fill({
          color: 0xecfeff,
        });
      }),
    );
    this.add(
      new Feel({
        show: dashBurst({
          target: visual,
          direction: { x: 1, y: 0 },
          stretch: 0.38,
          blur: { strength: 18 },
          lines: { color: 0x67e8f9, count: 10, length: [22, 52] },
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 4  Recipe: spawn pop
// ---------------------------------------------------------------------------

export class SpawnPopRecipeDemo extends FeelDemo {
  readonly label = "spawn pop recipe";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 53).fill({ color: 0x713f12 });
        g.circle(0, 0, 43).fill({ color: 0xf59e0b });
        g.poly([
          0, -28, 8, -9, 29, -9, 12, 4, 18, 27, 0, 14, -18, 27, -12, 4, -29, -9,
          -8, -9,
        ]).fill({ color: 0xfef3c7 });
      }),
    );
    this.add(
      new Feel({
        show: spawnPop({
          target: visual,
          startScale: 0.35,
          offset: { x: 0, y: 18 },
          glow: { color: 0xfde047, outerStrength: 4 },
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 5  Recipe: enemy death
// ---------------------------------------------------------------------------

/** An enemy the death recipe dissolves and then destroys. */
class EnemyDeathTarget extends Entity {
  setup(params: { seed: number }): void {
    this.add(new Transform());
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(-50, -50, 100, 100, 20).fill({ color: 0x581c87 });
        g.roundRect(-39, -39, 78, 78, 15).fill({ color: 0x9333ea });
        g.circle(-16, -7, 8).fill({ color: 0xf5d0fe });
        g.circle(16, -7, 8).fill({ color: 0xf5d0fe });
        g.moveTo(-21, 22)
          .quadraticCurveTo(0, 8, 21, 22)
          .stroke({ color: 0xe9d5ff, width: 5 });
      }),
    );
    this.add(
      new Feel({
        show: enemyDeath({
          target: visual,
          color: 0x22d3ee,
          dissolve: { noiseScale: 8, edgeWidth: 0.13, seed: params.seed },
          glow: { outerStrength: 5, distance: 14 },
          onComplete: (context) => context.entity.destroy(),
        }),
      }),
    );
  }
}

/**
 * Each play replaces the enemy with a fresh one and kills it, so the death
 * can repeat. Every enemy gets a new dissolve seed.
 */
class EnemySpawner extends Component {
  private generation = 0;
  private current: EnemyDeathTarget | undefined;

  onAdd(): void {
    this.current = this.spawnEnemy();
  }

  killFreshEnemy(): void {
    this.current?.destroy();
    this.generation += 1;
    const enemy = this.spawnEnemy();
    this.current = enemy;
    enemy.get(Feel).play("show");
  }

  private spawnEnemy(): EnemyDeathTarget {
    return this.entity.spawnChild(
      `enemy-${this.generation}`,
      EnemyDeathTarget,
      { seed: this.generation },
    );
  }
}

export class EnemyDeathRecipeDemo extends Entity implements ShowcaseDemo {
  readonly label = "enemy death recipe";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    this.add(new EnemySpawner());
  }

  play(): void {
    this.get(EnemySpawner).killFreshEnemy();
  }
}
