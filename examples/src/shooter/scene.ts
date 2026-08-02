import { Scene, Entity, Transform, Vec2 } from "@yagejs/core";
import {
  GraphicsComponent,
  CameraEntity,
  TextComponent,
  type LayerDef,
} from "@yagejs/renderer";
import { RigidBodyComponent, ColliderComponent } from "@yagejs/physics";
import { AudioManagerKey } from "@yagejs/audio";
import {
  WIDTH,
  HEIGHT,
  WORLD_W,
  WORLD_H,
  HUD_LAYER,
  LAYER_PLAYER,
  LAYER_PLATFORM,
  LAYER_BULLET,
  LAYER_ENEMY,
  EnemyKilled,
} from "./constants.js";
import {
  ShootSfx,
  HurtSfx,
  ExplosionSfx,
  JumpSfx,
  LandSfx,
  BgMusic,
  PlayerIdleTex,
  PlayerWalkTex,
  PlayerJumpTex,
  PlayerLandTex,
  PlayerShootTex,
  PlayerHurtTex,
  EnemyIdleTex,
  EnemyWalkTex,
  EnemyReactTex,
  EnemyAttackTex,
  EnemyHitTex,
  EnemyDieTex,
} from "./assets.js";
import { bindHud, resetGame, registerKill } from "./ui.js";
import { PlayerEntity } from "./player.js";
import { EnemyEntity } from "./enemies.js";

class PlatformEntity extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x475569 });
        g.rect(-w / 2, -h / 2, w, 3).fill({ color: 0x64748b });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        friction: 0,
        layers: LAYER_PLATFORM,
        mask: LAYER_PLAYER | LAYER_BULLET | LAYER_ENEMY,
      }),
    );
  }
}

/**
 * One-way variant: the player (and bullets) land on it from above and pass
 * through from below or the side. Amber top marks the solid face.
 */
class OneWayPlatformEntity extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-w / 2, -h / 2, w, h).fill({ color: 0x92400e });
        g.rect(-w / 2, -h / 2, w, 3).fill({ color: 0xf59e0b });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: w, height: h },
        friction: 0,
        layers: LAYER_PLATFORM,
        mask: LAYER_PLAYER | LAYER_BULLET | LAYER_ENEMY,
        oneWay: {},
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// ShooterScene
// ---------------------------------------------------------------------------
export class ShooterScene extends Scene {
  readonly name = "shooter";
  readonly preload = [
    ShootSfx,
    HurtSfx,
    ExplosionSfx,
    JumpSfx,
    LandSfx,
    BgMusic,
    PlayerIdleTex,
    PlayerWalkTex,
    PlayerJumpTex,
    PlayerLandTex,
    PlayerShootTex,
    PlayerHurtTex,
    EnemyIdleTex,
    EnemyWalkTex,
    EnemyReactTex,
    EnemyAttackTex,
    EnemyHitTex,
    EnemyDieTex,
  ];

  readonly layers: readonly LayerDef[] = [
    { name: "bg", order: -10 },
    { name: "world", order: 0 },
    { name: "bullets", order: 5 },
    { name: "player", order: 10 },
    { name: HUD_LAYER, order: 1000, space: "screen" },
  ];

  private readonly audio = this.service(AudioManagerKey);

  onEnter(): void {
    // In-canvas HUD (screen-space): enemy counter + centered win banner.
    const counter = this.spawn("hud");
    counter.add(new Transform({ position: new Vec2(WIDTH - 16, 16) }));
    const countText = counter.add(
      new TextComponent({
        text: "",
        anchor: { x: 1, y: 0 },
        style: { fontFamily: "monospace", fontSize: 18, fill: 0xef4444 },
        layer: HUD_LAYER,
      }),
    );

    const banner = this.spawn("win-banner");
    banner.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2 - 12) }));
    const bannerText = banner.add(
      new TextComponent({
        text: "You Win!",
        anchor: { x: 0.5, y: 0.5 },
        style: { fontFamily: "system-ui, sans-serif", fontSize: 32, fill: 0x22c55e, fontWeight: "bold" },
        layer: HUD_LAYER,
        visible: false,
      }),
    );

    const bannerSubEntity = this.spawn("win-banner-sub");
    bannerSubEntity.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2 + 22) }));
    const bannerSub = bannerSubEntity.add(
      new TextComponent({
        text: "All enemies defeated",
        anchor: { x: 0.5, y: 0.5 },
        style: { fontFamily: "system-ui, sans-serif", fontSize: 14, fill: 0x38bdf8 },
        layer: HUD_LAYER,
        visible: false,
      }),
    );

    bindHud(countText, bannerText, bannerSub);
    resetGame();

    const cam = this.spawn(CameraEntity);

    // Background music
    this.audio.play(BgMusic.path, { channel: "music", loop: true });

    // Scene-level event listener: track enemy kills
    this.on(EnemyKilled, () => registerKill());

    this.drawBackground();
    this.buildLevel();
    this.spawnEnemies(cam);
    this.spawn(PlayerEntity, { camera: cam });
  }

  // -- Background --
  private drawBackground(): void {
    const bg = this.spawn("background");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent({ layer: "bg" }).draw((g) => {
        for (let y = 0; y < WORLD_H; y += 40) {
          const alpha = 0.03 + (y / WORLD_H) * 0.04;
          g.rect(0, y, WORLD_W, 40).fill({ color: 0x334155, alpha });
        }
        for (let x = 0; x <= WORLD_W; x += 100) {
          g.moveTo(x, 0)
            .lineTo(x, WORLD_H)
            .stroke({ color: 0x1e293b, width: 1 });
        }
        for (let y = 0; y <= WORLD_H; y += 100) {
          g.moveTo(0, y)
            .lineTo(WORLD_W, y)
            .stroke({ color: 0x1e293b, width: 1 });
        }
        g.rect(0, 0, WORLD_W, WORLD_H).stroke({ color: 0x334155, width: 2 });
      }),
    );
  }

  // -- Level geometry --
  private buildLevel(): void {
    // Full-width ground floor
    this.spawn(PlatformEntity, { x: WORLD_W / 2, y: 750, w: WORLD_W, h: 100 });

    // Left wall
    this.spawn(PlatformEntity, { x: -5, y: WORLD_H / 2, w: 10, h: WORLD_H });
    // Right wall
    this.spawn(PlatformEntity, {
      x: WORLD_W + 5,
      y: WORLD_H / 2,
      w: 10,
      h: WORLD_H,
    });

    // Elevated platforms for verticality. The two without patrolling
    // enemies are one-way: jump up through them, press down to drop.
    this.spawn(OneWayPlatformEntity, { x: 300, y: 620, w: 120, h: 20 }); // lower-left platform
    this.spawn(PlatformEntity, { x: 550, y: 540, w: 100, h: 20 }); // mid-left platform
    this.spawn(PlatformEntity, { x: 800, y: 600, w: 140, h: 20 }); // mid-right platform
    this.spawn(PlatformEntity, { x: 1000, y: 520, w: 120, h: 20 }); // upper-right platform
    this.spawn(OneWayPlatformEntity, { x: 700, y: 440, w: 100, h: 20 }); // high central platform
  }

  // -- Enemies --
  private spawnEnemies(camera: CameraEntity): void {
    this.spawn(EnemyEntity, { x: 350, y: 680, patrolLeft: 200, patrolRight: 450, camera }); // ground left
    this.spawn(EnemyEntity, { x: 600, y: 680, patrolLeft: 450, patrolRight: 750, camera }); // ground mid
    this.spawn(EnemyEntity, { x: 950, y: 680, patrolLeft: 800, patrolRight: 1100, camera }); // ground right
    this.spawn(EnemyEntity, { x: 550, y: 470, patrolLeft: 500, patrolRight: 600, camera }); // on mid-left platform
    this.spawn(EnemyEntity, { x: 850, y: 530, patrolLeft: 770, patrolRight: 940, camera }); // on mid-right platform
    this.spawn(EnemyEntity, {
      x: 1050,
      y: 450,
      patrolLeft: 940,
      patrolRight: 1150,
      camera,
    }); // on upper-right platform
  }
}
