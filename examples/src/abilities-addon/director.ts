import {
  Component,
  Entity,
  ProcessComponent,
  RandomKey,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { ProcessSlot } from "@yagejs/core";
import { Health, HealthDied } from "@yagejs-addons/abilities";
import { ARENA_MARGIN, HEIGHT, PLAYER_KEY, WIDTH } from "./constants.js";
import { statsOf } from "./stats.js";
import {
  EnemyEntity,
  MAX_PICKUPS,
  PICKUP_COLLECT_RANGE,
  PICKUP_SPAWN_INTERVAL,
  PICKUP_SPECS,
  Pickup,
  PickupEntity,
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
/** Minimum seconds between two enemy respawns. */
export const ENEMY_RESPAWN_DELAY = 2.5;
/** Seconds before the first stat gem can drop. */
export const FIRST_PICKUP_DELAY = 2;
export const KILLS_PER_LEVEL = 3;

/** Needs a `ProcessComponent` on its entity; `GameDirectorEntity` adds
 *  both. */
export class GameDirector extends Component {
  private readonly pc = this.sibling(ProcessComponent);
  private readonly random = this.service(RandomKey);
  /** Running while the next enemy respawn has to wait. */
  private respawnCooldown!: ProcessSlot;
  /** Running while the next stat gem has to wait. */
  private pickupCooldown!: ProcessSlot;

  onAdd(): void {
    this.respawnCooldown = this.pc
      .slot({ duration: ENEMY_RESPAWN_DELAY })
      .start();
    this.pickupCooldown = this.pc
      .slot({ duration: PICKUP_SPAWN_INTERVAL })
      .start({ duration: FIRST_PICKUP_DELAY });
    this.listenScene(HealthDied, (_data, entity) => {
      if (entity?.tags.has("enemy")) this.onEnemyKilled();
    });
  }

  update(): void {
    if (
      !this.respawnCooldown.running &&
      this.livingEnemies() < TARGET_ENEMIES
    ) {
      this.spawnEnemy();
      this.respawnCooldown.restart();
    }

    if (!this.pickupCooldown.running && this.pickupCount() < MAX_PICKUPS) {
      this.spawnPickup();
      this.pickupCooldown.restart();
    }

    this.collectPickups();
  }

  /** A kill feeds the level-up loop: past the per-level threshold, the player
   *  gains atk/def/maxHp (maxHp pushed into `Health`). */
  private onEnemyKilled(): void {
    const player = this.scene.findByKey(PLAYER_KEY);
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
    const spec = this.random.pick(PICKUP_SPECS);
    this.scene.spawn(PickupEntity, {
      spec,
      position: this.randomArenaPoint(60),
    });
  }

  private collectPickups(): void {
    const player = this.scene.findByKey(PLAYER_KEY);
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
      .findByKey(PLAYER_KEY)
      ?.tryGet(Transform)?.worldPosition;
    for (let i = 0; i < 8; i++) {
      const p = new Vec2(
        this.random.range(pad, WIDTH - pad),
        this.random.range(pad, HEIGHT - pad),
      );
      if (!playerPos || p.sub(playerPos).length() >= minPlayerDist) return p;
    }
    return new Vec2(WIDTH / 2, ARENA_MARGIN + 60);
  }
}

/** Hosts the scene's `GameDirector`. */
export class GameDirectorEntity extends Entity {
  setup(): void {
    this.add(new ProcessComponent());
    this.add(new GameDirector());
  }
}
