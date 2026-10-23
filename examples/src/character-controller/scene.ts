import { Scene, Vec2 } from "@yagejs/core";
import { CameraEntity, type LayerDef } from "@yagejs/renderer";
import {
  COLORS,
  FLOOR_Y,
  HEIGHT,
  HUD_LAYER,
  STATIONS,
  WIDTH,
  WORLD_WIDTH,
} from "./constants.js";
import {
  MovingPlatformEntity,
  OneWayPlatformEntity,
  PlatformEntity,
  RampEntity,
  SignEntity,
} from "./level.js";
import { HudEntity } from "./hud.js";

/** One long room with a zone per controller feature, left to right. */
export class CharacterControllerScene extends Scene {
  readonly name = "character-controller";
  readonly layers: readonly LayerDef[] = [
    { name: "world", order: 0 },
    { name: "player", order: 10 },
    { name: HUD_LAYER, order: 1000, space: "screen" },
  ];

  onEnter(): void {
    const camera = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
      bounds: { minX: 0, minY: 0, maxX: WORLD_WIDTH, maxY: HEIGHT },
    });
    this.spawn(PlatformEntity, {
      x: WORLD_WIDTH / 2,
      y: FLOOR_Y + 30,
      width: WORLD_WIDTH,
      height: 60,
    });
    this.spawn(PlatformEntity, { x: -10, y: 300, width: 20, height: 600 });
    this.spawn(PlatformEntity, {
      x: WORLD_WIDTH + 10,
      y: 300,
      width: 20,
      height: 600,
    });
    for (const [index, station] of STATIONS.entries()) {
      this.spawn(SignEntity, {
        x: station.x + 140,
        y: 175,
        text: `${index + 1}  /  ${station.name}`,
        color: COLORS.player,
      });
    }

    this.spawn(OneWayPlatformEntity, { x: 180, y: 452, width: 180 });
    this.spawn(OneWayPlatformEntity, { x: 390, y: 350, width: 150 });
    this.spawn(SignEntity, {
      x: 230,
      y: 285,
      text: "Hold jump for height · jump again in the air\nDown + jump drops through",
      color: COLORS.oneWay,
    });

    this.spawn(PlatformEntity, { x: 930, y: 486, width: 200, height: 40 });
    this.spawn(SignEntity, {
      x: 890,
      y: 430,
      text: "RUN, THEN PRESS DOWN BEFORE THE ENTRANCE\nRelease down inside: you stay low until clear",
    });

    // Six-pixel risers match the default step-assistance limit.
    for (let step = 0; step < 10; step++) {
      const height = 6 * (step < 5 ? step + 1 : 10 - step);
      this.spawn(PlatformEntity, {
        x: 1360 + step * 40,
        y: FLOOR_Y - height / 2,
        width: 40,
        height,
      });
    }
    this.spawn(SignEntity, {
      x: 1510,
      y: 405,
      text: "6 px STEPS · WALK BOTH DIRECTIONS\nNo jump needed",
    });

    // Continuous alternating inclines exercise crests, valleys, and ground snap.
    const heights = [0, 70, 15, 100, 25, 80, 0];
    for (let ramp = 0; ramp < heights.length - 1; ramp++) {
      this.spawn(RampEntity, {
        x: 1960 + ramp * 140,
        width: 140,
        left: heights[ramp] ?? 0,
        right: heights[ramp + 1] ?? 0,
      });
    }
    this.spawn(SignEntity, {
      x: 2370,
      y: 315,
      text: "UP / DOWN / UP / DOWN\nRun across the crests, then turn around",
    });

    this.spawn(MovingPlatformEntity, {
      x: 3020,
      y: 450,
      width: 120,
      to: { x: 3260, y: 350 },
    });
    this.spawn(SignEntity, {
      x: 3150,
      y: 285,
      text: "JUMP ON · RIDE · JUMP OFF\nDown + jump drops through",
      color: COLORS.moving,
    });

    this.spawn(PlatformEntity, { x: 3700, y: 475, width: 160, height: 130 });
    this.spawn(PlatformEntity, { x: 3900, y: 442, width: 120, height: 196 });
    this.spawn(SignEntity, {
      x: 3710,
      y: 255,
      text: "JUMP, THEN FALL PAST THE EDGE HOLDING TOWARD IT\nJump climbs · down lets go\nThe example builds this move on LedgeProbe",
      color: COLORS.moving,
    });

    this.spawn(PlatformEntity, { x: 4250, y: 400, width: 40, height: 280 });
    this.spawn(SignEntity, {
      x: 4220,
      y: 220,
      text: "HOLD TOWARD THE WALL\nJump, then jump again",
    });

    // The HUD spawns the player. Spawning it last puts the player after the
    // moving platform, which has to update first in each step.
    this.spawn(HudEntity, { camera });
  }
}
