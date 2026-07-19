import { Entity, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  TextComponent,
} from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { HealthDied } from "@yagejs-addons/abilities";
import {
  ARENA_MARGIN,
  CAMERA_FOLLOW_SMOOTHING,
  CAMERA_ZOOM,
  HEIGHT,
  HUD_LAYER,
  WIDTH,
} from "./constants.js";
import { BOXER_PRELOAD } from "./boxer-sprites.js";
import { BlockSfx, DeathSfx, HitSfx, createVfxHub } from "./feedback.js";
import type { VfxHub } from "./feedback.js";
import { EngagementToken, EnemyEntity } from "./enemies.js";
import { GameDirector } from "./director.js";
import { CombatLog, Hud, deadBanner, spawnHotbar } from "./hud.js";
import { PlayerEntity } from "./player.js";

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

export class Wall extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-params.w / 2, -params.h / 2, params.w, params.h).fill({
          color: 0x1e293b,
        });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: params.w, height: params.h },
      }),
    );
  }
}

export class AbilitiesDemoScene extends Scene {
  readonly name = "abilities-addon-demo";
  readonly preload = [...BOXER_PRELOAD, HitSfx, BlockSfx, DeathSfx];
  readonly layers: readonly LayerDef[] = [
    { name: HUD_LAYER, order: 1200, space: "screen" },
  ];

  camera!: CameraEntity;
  fx!: VfxHub;
  token!: EngagementToken;

  onEnter(): void {
    // R (see `PlayerController.resetDemo`) rebuilds this scene from scratch —
    // hide any banner left over from a previous run before anything below
    // re-shows it.
    deadBanner.hide();

    // Positioned at the arena's center so the layer transform this camera
    // drives is the identity at rest — `PlayerController` hands it a follow
    // target below once the player exists. Clamped to the arena so the
    // zoomed-in view never scrolls past the walls into the background.
    this.camera = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
      zoom: CAMERA_ZOOM,
      bounds: { minX: 0, minY: 0, maxX: WIDTH, maxY: HEIGHT },
    });
    this.fx = createVfxHub(this);
    const tokenEntity = this.spawn("engagement-token");
    tokenEntity.add(new Transform());
    this.token = tokenEntity.add(new EngagementToken());

    this.buildArena();

    const player = this.spawn(PlayerEntity);
    // Shake (see `cameraOf(...).shake(...)` throughout) composes with follow
    // automatically: `CameraShake` only ever offsets `effectivePosition`,
    // never `CameraComponent.position` itself (the field `CameraFollow` and
    // `CameraBoundsComponent` read/write) — so the two never fight or drift.
    this.camera.follow(player.get(Transform), {
      smoothing: CAMERA_FOLLOW_SMOOTHING,
    });
    this.spawn(EnemyEntity, {
      position: new Vec2(WIDTH / 2 - 200, HEIGHT / 2 - 110),
    });
    this.spawn(EnemyEntity, {
      position: new Vec2(WIDTH / 2 + 200, HEIGHT / 2 - 110),
    });
    this.spawn(EnemyEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2 + 170),
    });

    // Drives the stats-boundary demo: respawns, stat-gem drops, and the
    // kill-fed level-up loop (see `GameDirector`).
    const director = this.spawn("game-director");
    director.add(new Transform());
    director.add(new GameDirector());

    const hudEntity = this.spawn("hud");
    hudEntity.add(new Transform({ position: new Vec2(16, 16) }));
    const log = hudEntity.add(new CombatLog());
    const text = hudEntity.add(
      new TextComponent({
        text: "",
        style: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          fill: 0xe2e8f0,
          lineHeight: 18,
        },
        layer: HUD_LAYER,
      }),
    );
    hudEntity.add(new Hud(text, log));

    spawnHotbar(this);

    this.on(HealthDied, (_data, entity) => {
      if (entity?.tags.has("player")) {
        deadBanner.show();
      }
    });
  }

  private buildArena(): void {
    const t = ARENA_MARGIN;
    this.spawn(Wall, { x: WIDTH / 2, y: t / 2, w: WIDTH, h: t });
    this.spawn(Wall, { x: WIDTH / 2, y: HEIGHT - t / 2, w: WIDTH, h: t });
    this.spawn(Wall, { x: t / 2, y: HEIGHT / 2, w: t, h: HEIGHT });
    this.spawn(Wall, { x: WIDTH - t / 2, y: HEIGHT / 2, w: t, h: HEIGHT });
  }
}
