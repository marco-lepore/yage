import { Scene, Transform, Vec2 } from "@yagejs/core";
import {
  GraphicsComponent,
  CameraEntity,
  TextComponent,
  type LayerDef,
} from "@yagejs/renderer";
import { RigidBodyComponent } from "@yagejs/physics";
import { AudioManagerKey } from "@yagejs/audio";
import {
  WIDTH,
  HEIGHT,
  WORLD_W,
  WORLD_H,
  HUD_LAYER,
  SPAWN,
  JumpSfx,
  LandSfx,
  CoinSfx,
  HurtSfx,
  WinSfx,
  BgMusic,
  CoinCollected,
  PlayerDied,
  GoalReached,
} from "./constants.js";
import { bindHud, resetGame, addCoin, showWin } from "./hud.js";
import { PlayerEntity } from "./player.js";
import {
  PlatformEntity,
  MovingPlatformEntity,
  OneWayPlatformEntity,
  CoinEntity,
  DeathZoneEntity,
  GoalEntity,
} from "./level.js";

// ---------------------------------------------------------------------------
// PlatformerScene
// ---------------------------------------------------------------------------
export class PlatformerScene extends Scene {
  readonly name = "platformer";
  readonly preload = [JumpSfx, LandSfx, CoinSfx, HurtSfx, WinSfx, BgMusic];

  readonly layers: readonly LayerDef[] = [
    { name: "bg", order: -10 },
    { name: "world", order: 0 },
    { name: "player", order: 10 },
    { name: HUD_LAYER, order: 1000, space: "screen" },
  ];

  private readonly audio = this.service(AudioManagerKey);

  onEnter(): void {
    // In-canvas HUD (screen-space): coin counter + centered win banner.
    const coinEntity = this.spawn("hud");
    coinEntity.add(new Transform({ position: new Vec2(WIDTH - 16, 16) }));
    const coinText = coinEntity.add(
      new TextComponent({
        text: "",
        anchor: { x: 1, y: 0 },
        style: { fontFamily: "monospace", fontSize: 20, fill: 0xffe66d },
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
        text: "",
        anchor: { x: 0.5, y: 0.5 },
        style: { fontFamily: "system-ui, sans-serif", fontSize: 14, fill: 0xffe66d },
        layer: HUD_LAYER,
        visible: false,
      }),
    );

    bindHud(coinText, bannerText, bannerSub);
    resetGame();

    const cam = this.spawn(CameraEntity);

    // Background music
    this.audio.play(BgMusic.path, { channel: "music", loop: true });

    // Scene-level event listeners
    this.on(CoinCollected, () => {
      addCoin();
      this.audio.play(CoinSfx.path, { channel: "sfx" });
    });
    this.drawBackground();
    this.buildLevel();
    const player = this.spawn(PlayerEntity, { camera: cam });

    this.on(PlayerDied, () => {
      this.audio.play(HurtSfx.path, { channel: "sfx" });
      const rb = player.get(RigidBodyComponent);
      rb.setVelocity(Vec2.ZERO);
      rb.setPosition(SPAWN.x, SPAWN.y);
      player.get(Transform).setPosition(SPAWN.x, SPAWN.y);
    });
    this.on(GoalReached, () => {
      this.audio.play(WinSfx.path, { channel: "sfx" });
      showWin();
    });
  }

  // -- Background grid --
  private drawBackground(): void {
    const bg = this.spawn("background");
    bg.add(new Transform());
    bg.add(
      new GraphicsComponent({ layer: "bg" }).draw((g) => {
        // Sky gradient feel via horizontal bands
        for (let y = 0; y < WORLD_H; y += 40) {
          const alpha = 0.03 + (y / WORLD_H) * 0.04;
          g.rect(0, y, WORLD_W, 40).fill({ color: 0x334155, alpha });
        }
        // Grid lines for depth/motion cue
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
        // World boundary
        g.rect(0, 0, WORLD_W, WORLD_H).stroke({ color: 0x334155, width: 2 });
      }),
    );
  }

  // -- Level geometry --
  private buildLevel(): void {
    // ============================================================
    // Section 1 (0–500): Start ground + 2 coins
    // ============================================================
    this.spawn(PlatformEntity, { x: 250, y: 750, w: 500, h: 100 }); // ground
    this.spawn(CoinEntity, { x: 200, y: 680 });
    this.spawn(CoinEntity, { x: 400, y: 650 });

    // One-way ledges above the start ground: jump up through them from
    // below, press down (S / ArrowDown) to drop back through.
    this.spawn(OneWayPlatformEntity, { x: 250, y: 620, w: 140 });
    this.spawn(OneWayPlatformEntity, { x: 250, y: 540, w: 140 });
    this.spawn(CoinEntity, { x: 250, y: 510 });

    // ============================================================
    // Section 2 (500–900): Gap with stepping stones + 2 coins
    // ============================================================
    this.spawn(DeathZoneEntity, { x: 700, y: 790, w: 400, h: 20 }); // pit death zone
    this.spawn(PlatformEntity, { x: 580, y: 700, w: 80, h: 20 }); // stepping stone 1
    this.spawn(PlatformEntity, { x: 700, y: 660, w: 80, h: 20 }); // stepping stone 2
    this.spawn(PlatformEntity, { x: 820, y: 620, w: 80, h: 20 }); // stepping stone 3
    this.spawn(CoinEntity, { x: 580, y: 670 });
    this.spawn(CoinEntity, { x: 820, y: 590 });

    // ============================================================
    // Section 3 (900–1400): Moving platforms + 1 coin
    // ============================================================
    this.spawn(PlatformEntity, { x: 950, y: 700, w: 120, h: 20 }); // landing after gap

    // Horizontal mover
    this.spawn(MovingPlatformEntity, {
      start: new Vec2(1100, 650),
      end: new Vec2(1300, 650),
      w: 100,
      h: 20,
      period: 3,
    });

    // Vertical mover — one-way, so it can be boarded from below as it
    // rises and dropped through with down.
    this.spawn(MovingPlatformEntity, {
      start: new Vec2(1350, 650),
      end: new Vec2(1350, 500),
      w: 100,
      h: 20,
      period: 2.5,
      oneWay: true,
    });

    this.spawn(CoinEntity, { x: 1200, y: 610 });

    // ============================================================
    // Section 4 (1400–1900): Ascending elevated platforms + 2 coins
    // ============================================================
    this.spawn(PlatformEntity, { x: 1450, y: 600, w: 120, h: 20 });
    this.spawn(PlatformEntity, { x: 1580, y: 540, w: 120, h: 20 });
    this.spawn(PlatformEntity, { x: 1720, y: 480, w: 120, h: 20 });
    this.spawn(PlatformEntity, { x: 1860, y: 420, w: 140, h: 20 });
    this.spawn(CoinEntity, { x: 1580, y: 510 });
    this.spawn(CoinEntity, { x: 1860, y: 390 });

    // ============================================================
    // Section 5 (1900–2400): Final run + vertical mover + goal
    // ============================================================
    this.spawn(PlatformEntity, { x: 2050, y: 500, w: 200, h: 20 }); // bridge from elevated

    // Vertical mover down to final ground
    this.spawn(MovingPlatformEntity, {
      start: new Vec2(2200, 500),
      end: new Vec2(2200, 700),
      w: 100,
      h: 20,
      period: 3,
    });

    this.spawn(PlatformEntity, { x: 2300, y: 750, w: 200, h: 100 }); // final ground
    this.spawn(CoinEntity, { x: 2200, y: 460 });
    this.spawn(GoalEntity, { x: 2350, y: 690 });

    // ============================================================
    // World floor (catches player at very bottom except in pits)
    // ============================================================
    this.spawn(PlatformEntity, { x: WORLD_W / 2, y: 795, w: WORLD_W, h: 10 });

    // Left wall
    this.spawn(PlatformEntity, { x: -5, y: WORLD_H / 2, w: 10, h: WORLD_H });
    // Right wall
    this.spawn(PlatformEntity, { x: WORLD_W + 5, y: WORLD_H / 2, w: 10, h: WORLD_H });
  }
}
