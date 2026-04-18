import { Scene, Transform, Vec2, defineEvent } from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  texture,
  type LayerDef,
} from "@yagejs/renderer";
import { sound } from "@yagejs/audio";
import { RigidBodyComponent } from "@yagejs/physics";
import { Player } from "../entities/Player/index";
import { Platform } from "../entities/Platform";
import { Coin } from "../entities/Coin";
import { Hazard } from "../entities/Hazard";
import { Slime } from "../entities/Slime";
import { Wall } from "../entities/Wall";
import { Hostile } from "../traits";

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
export const playerIdleTex = texture("/assets/player-idle.png");
export const playerWalkTex = texture("/assets/player-walk.png");
export const playerJumpTex = texture("/assets/player-jump.png");
export const coinTex = texture("/assets/coin.png");
export const slimeTex = texture("/assets/slime_purple.png");
export const jumpSfx = sound("/assets/jump.wav");
export const hurtSfx = sound("/assets/hurt.wav");

/** Player sprite strips use 48×48 frames. */
export const PLAYER_FRAME_SIZE = 48;
/** Coin sprite strip uses 16×16 frames. */
export const COIN_FRAME_SIZE = 16;
/** Slime sprite sheet first row: 24×24 frames. */
export const SLIME_FRAME_SIZE = 24;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export const PlayerHit = defineEvent("game:player-hit");

// ---------------------------------------------------------------------------
// Level constants
// ---------------------------------------------------------------------------
const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 600;
const SPAWN_X = 120;
const SPAWN_Y = 400;
const GROUND_Y = 506;

export class GameScene extends Scene {
  readonly name = "game";
  readonly preload = [
    playerIdleTex,
    playerWalkTex,
    playerJumpTex,
    coinTex,
    slimeTex,
    jumpSfx,
    hurtSfx,
  ];
  readonly layers: readonly LayerDef[] = [
    { name: "background", order: -10 },
    { name: "world", order: 0 },
    { name: "player", order: 10 },
  ];

  onEnter(): void {
    this.drawBackground();
    this.buildLevel();

    const player = this.spawn(Player, { x: SPAWN_X, y: SPAWN_Y });

    this.spawn(CameraEntity, {
      follow: player.get(Transform),
      smoothing: 0.12,
      bounds: { minX: 0, minY: 0, maxX: WORLD_WIDTH, maxY: WORLD_HEIGHT },
    });

    this.on(PlayerHit, () => {
      const p = this.findEntity("player");
      if (!p) return;
      const rb = p.get(RigidBodyComponent);
      rb.setVelocity(Vec2.ZERO);
      rb.setPosition(SPAWN_X, SPAWN_Y);
      p.get(Transform).setPosition(SPAWN_X, SPAWN_Y);

      for (const entity of this.findEntities({ trait: Hostile })) {
        if (entity instanceof Slime) {
          entity.resetPosition();
        }
      }
    });
  }

  private drawBackground(): void {
    const bg = this.spawn("background");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent({ layer: "background" }).draw((g) => {
        for (let x = 0; x <= WORLD_WIDTH; x += 100) {
          g.moveTo(x, 0)
            .lineTo(x, WORLD_HEIGHT)
            .stroke({ color: 0x1e293b, width: 1 });
        }
        for (let y = 0; y <= WORLD_HEIGHT; y += 100) {
          g.moveTo(0, y)
            .lineTo(WORLD_WIDTH, y)
            .stroke({ color: 0x1e293b, width: 1 });
        }
      }),
    );
  }

  private buildLevel(): void {
    // Ground
    this.spawn(Platform, {
      x: WORLD_WIDTH / 2,
      y: 560,
      width: WORLD_WIDTH,
      height: 60,
    });

    // Floating platforms
    this.spawn(Platform, { x: 380, y: 450, width: 160, height: 20 });
    this.spawn(Platform, { x: 620, y: 370, width: 160, height: 20 });
    this.spawn(Platform, { x: 900, y: 290, width: 160, height: 20 });
    this.spawn(Platform, { x: 1180, y: 370, width: 160, height: 20 });
    this.spawn(Platform, { x: 1400, y: 460, width: 200, height: 20 });

    // Coins
    this.spawn(Coin, { x: 380, y: 410 });
    this.spawn(Coin, { x: 900, y: 250 });
    this.spawn(Coin, { x: 1400, y: 420 });

    // Hazards — slide horizontally
    this.spawn(Hazard, { x: 620, y: 340, amplitude: 60, period: 2.2 });
    this.spawn(Hazard, { x: 1180, y: 340, amplitude: 70, period: 2.6 });

    // Slimes — patrol the ground floor, chase the player
    this.spawn(Slime, { x: 500, y: GROUND_Y });
    this.spawn(Slime, { x: 1000, y: GROUND_Y });
    this.spawn(Slime, { x: 1300, y: GROUND_Y });

    // Side walls
    this.spawn(Wall, {
      x: -10,
      y: WORLD_HEIGHT / 2,
      width: 20,
      height: WORLD_HEIGHT,
    });
    this.spawn(Wall, {
      x: WORLD_WIDTH + 10,
      y: WORLD_HEIGHT / 2,
      width: 20,
      height: WORLD_HEIGHT,
    });
  }
}
