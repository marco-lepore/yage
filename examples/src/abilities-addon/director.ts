import { Component, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { Health, HealthDied } from "@yagejs-addons/abilities";
import { ARENA_MARGIN, HEIGHT, WIDTH } from "./constants.js";
import { statsOf } from "./stats.js";
import {
  EnemyEntity,
  MAX_PICKUPS,
  PICKUP_COLLECT_RANGE,
  PICKUP_SPAWN_INTERVAL,
  PICKUP_SPECS,
  Pickup,
  grantStat,
} from "./enemies.js";

// ---------------------------------------------------------------------------
// Progression + pickups — the demand-generating half of the stats slice. A
// scene-level `GameDirector` keeps the arena populated (respawns enemies),
// drops stat gems the player collects by walking over them, and runs a
// kill-fed level-up loop that raises the player's `Stats`. Everything here is
// plain game code; the addon touch points are `statsOf`/`pushMaxHp` above.
// ---------------------------------------------------------------------------

export const TARGET_ENEMIES = 3;
export const ENEMY_RESPAWN_DELAY = 2.5;
export const KILLS_PER_LEVEL = 3;

export class GameDirector extends Component {
  private respawnTimer = ENEMY_RESPAWN_DELAY;
  private pickupTimer = 2;

  onAdd(): void {
    this.listenScene(HealthDied, (_data, entity) => {
      if (entity?.tags.has("enemy")) this.onEnemyKilled();
    });
  }

  update(dt: number): void {
    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0 && this.livingEnemies() < TARGET_ENEMIES) {
      this.spawnEnemy();
      this.respawnTimer = ENEMY_RESPAWN_DELAY;
    }

    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0 && this.pickupCount() < MAX_PICKUPS) {
      this.spawnPickup();
      this.pickupTimer = PICKUP_SPAWN_INTERVAL;
    }

    this.collectPickups();
  }

  /** A kill feeds the level-up loop: past the per-level threshold, the player
   *  gains atk/def/maxHp (maxHp pushed into `Health`). */
  private onEnemyKilled(): void {
    const player = this.scene.findEntity("PlayerEntity");
    const stats = player && statsOf(player);
    if (!player || !stats) return;
    stats.kills++;
    if (stats.kills >= stats.level * KILLS_PER_LEVEL) {
      stats.level++;
      grantStat(player, stats, "atk", 2);
      grantStat(player, stats, "def", 1);
      grantStat(player, stats, "maxHp", 15);
    }
  }

  private livingEnemies(): number {
    let n = 0;
    for (const e of this.scene.getEntities()) {
      if (e.tags.has("enemy") && !(e.tryGet(Health)?.isDead ?? true)) n++;
    }
    return n;
  }

  private pickupCount(): number {
    let n = 0;
    for (const e of this.scene.getEntities()) if (e.tryGet(Pickup)) n++;
    return n;
  }

  private spawnEnemy(): void {
    this.scene.spawn(EnemyEntity, { position: this.randomArenaPoint(90) });
  }

  private spawnPickup(): void {
    const spec = PICKUP_SPECS[Math.floor(Math.random() * PICKUP_SPECS.length)];
    if (!spec) return;
    const gem = this.scene.spawn("pickup");
    gem.add(new Transform({ position: this.randomArenaPoint(60) }));
    gem.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(-9, -9, 18, 18, 4)
          .fill({ color: spec.color })
          .stroke({ color: 0xffffff, width: 1.5, alpha: 0.7 });
      }),
    );
    gem.add(new Pickup(spec));
  }

  private collectPickups(): void {
    const player = this.scene.findEntity("PlayerEntity");
    const stats = player && statsOf(player);
    const playerPos = player?.tryGet(Transform)?.worldPosition;
    if (
      !player ||
      !stats ||
      !playerPos ||
      (player.tryGet(Health)?.isDead ?? false)
    )
      return;
    for (const e of this.scene.getEntities()) {
      const pickup = e.tryGet(Pickup);
      const pos = e.tryGet(Transform)?.worldPosition;
      if (!pickup || !pos) continue;
      if (pos.sub(playerPos).length() > PICKUP_COLLECT_RANGE) continue;
      grantStat(player, stats, pickup.spec.kind, pickup.spec.gain);
      e.destroy();
    }
  }

  /** A random point inside the arena, kept `minPlayerDist` px off the player
   *  so a spawn never lands on top of them. */
  private randomArenaPoint(minPlayerDist: number): Vec2 {
    const pad = ARENA_MARGIN + 40;
    const playerPos = this.scene
      .findEntity("PlayerEntity")
      ?.tryGet(Transform)?.worldPosition;
    for (let i = 0; i < 8; i++) {
      const p = new Vec2(
        pad + Math.random() * (WIDTH - 2 * pad),
        pad + Math.random() * (HEIGHT - 2 * pad),
      );
      if (!playerPos || p.sub(playerPos).length() >= minPlayerDist) return p;
    }
    return new Vec2(WIDTH / 2, ARENA_MARGIN + 60);
  }
}
