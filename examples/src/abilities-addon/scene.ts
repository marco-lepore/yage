import { Entity, Scene, Transform, Vec2 } from "@yagejs/core";
import { CameraEntity, GraphicsComponent } from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import {
  ARENA_MARGIN,
  CAMERA_FOLLOW_SMOOTHING,
  CAMERA_KEY,
  CAMERA_ZOOM,
  ENGAGEMENT_TOKEN_KEY,
  HEIGHT,
  HUD_LAYER,
  PLAYER_KEY,
  VFX_KEY,
  WIDTH,
} from "./constants.js";
import { BOXER_PRELOAD } from "./boxer-sprites.js";
import { BlockSfx, DeathSfx, HitSfx, VfxEntity } from "./feedback.js";
import { EngagementTokenEntity, EnemyEntity } from "./enemies.js";
import { GameDirectorEntity } from "./director.js";
import { DeadBannerEntity, HotbarEntity, HudEntity } from "./hud.js";
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

  // The keyed entities (camera, VFX hub, engagement token, player) are
  // reached from components with `scene.findByKey`.
  onEnter(): void {
    // Positioned at the arena's center so the layer transform this camera
    // drives is the identity at rest; it follows the player once the player
    // exists below. Clamped to the arena so the zoomed-in view never scrolls
    // past the walls into the background.
    const camera = this.spawn(
      CameraEntity,
      {
        position: new Vec2(WIDTH / 2, HEIGHT / 2),
        zoom: CAMERA_ZOOM,
        bounds: { minX: 0, minY: 0, maxX: WIDTH, maxY: HEIGHT },
      },
      { key: CAMERA_KEY },
    );
    this.spawn(VfxEntity, { key: VFX_KEY });
    this.spawn(EngagementTokenEntity, { key: ENGAGEMENT_TOKEN_KEY });

    this.buildArena();

    const player = this.spawn(PlayerEntity, { key: PLAYER_KEY });
    // Shake (see `cameraOf(...).shake(...)` throughout) composes with follow
    // automatically: `CameraShake` only ever offsets `effectivePosition`,
    // never `CameraComponent.position` itself (the field `CameraFollow` and
    // `CameraBoundsComponent` read/write) — so the two never fight or drift.
    camera.follow(player.get(Transform), {
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
    this.spawn(GameDirectorEntity);

    this.spawn(HudEntity);
    this.spawn(HotbarEntity);
    this.spawn(DeadBannerEntity);
  }

  private buildArena(): void {
    const t = ARENA_MARGIN;
    this.spawn(Wall, { x: WIDTH / 2, y: t / 2, w: WIDTH, h: t });
    this.spawn(Wall, { x: WIDTH / 2, y: HEIGHT - t / 2, w: WIDTH, h: t });
    this.spawn(Wall, { x: t / 2, y: HEIGHT / 2, w: t, h: HEIGHT });
    this.spawn(Wall, { x: WIDTH - t / 2, y: HEIGHT / 2, w: t, h: HEIGHT });
  }
}
