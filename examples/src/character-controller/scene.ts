import { Scene, Vec2 } from "@yagejs/core";
import { CameraEntity, type LayerDef } from "@yagejs/renderer";
import { COLORS, HEIGHT, STATIONS, WIDTH, WORLD_WIDTH } from "./constants.js";
import { Platform, Ramp, Sign } from "./level.js";
import { Hud } from "./hud.js";

export class CharacterControllerScene extends Scene {
  readonly name = "character-controller";
  readonly layers: readonly LayerDef[] = [
    { name: "world", order: 0 },
    { name: "player", order: 10 },
    { name: "hud", order: 1000, space: "screen" },
  ];
  onEnter(): void {
    const camera = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
      bounds: { minX: 0, minY: 0, maxX: WORLD_WIDTH, maxY: HEIGHT },
    });
    this.spawn(Platform, {
      x: WORLD_WIDTH / 2,
      y: 570,
      width: WORLD_WIDTH,
      height: 60,
    });
    this.spawn(Platform, { x: -10, y: 300, width: 20, height: 600 });
    this.spawn(Platform, {
      x: WORLD_WIDTH + 10,
      y: 300,
      width: 20,
      height: 600,
    });
    for (const [index, station] of STATIONS.entries()) {
      this.spawn(Sign, {
        x: station.x + 140,
        y: 175,
        text: `${index + 1}  /  ${station.name}`,
        color: COLORS.player,
      });
    }
    this.spawn(Platform, { x: 180, y: 452, width: 180, oneWay: true });
    this.spawn(Platform, { x: 390, y: 350, width: 150, oneWay: true });
    this.spawn(Sign, {
      x: 230,
      y: 285,
      text: "Hold jump for height · jump again in air\nE to drop through",
      color: COLORS.oneWay,
    });

    this.spawn(Platform, { x: 930, y: 486, width: 200, height: 40 });
    this.spawn(Sign, {
      x: 890,
      y: 430,
      text: "RUN, THEN S BEFORE THE ENTRANCE\nRelease S inside: stay low until clear",
    });

    // Six-pixel risers match the default step-assistance limit.
    for (let step = 0; step < 10; step++) {
      const height = 6 * (step < 5 ? step + 1 : 10 - step);
      this.spawn(Platform, {
        x: 1360 + step * 40,
        y: 540 - height / 2,
        width: 40,
        height,
      });
    }
    this.spawn(Sign, {
      x: 1510,
      y: 405,
      text: "6 px STEPS · WALK BOTH DIRECTIONS\nNo jump needed",
    });

    // Continuous alternating inclines exercise crests, valleys, and ground snap.
    const heights = [0, 70, 15, 100, 25, 80, 0];
    for (let ramp = 0; ramp < heights.length - 1; ramp++) {
      this.spawn(Ramp, {
        x: 1960 + ramp * 140,
        width: 140,
        left: heights[ramp] ?? 0,
        right: heights[ramp + 1] ?? 0,
      });
    }
    this.spawn(Sign, {
      x: 2370,
      y: 315,
      text: "UP / DOWN / UP / DOWN\nRun across the crests, then turn around",
    });

    this.spawn(Platform, {
      x: 3020,
      y: 450,
      width: 120,
      oneWay: true,
      to: { x: 3260, y: 350 },
    });
    this.spawn(Sign, {
      x: 3150,
      y: 285,
      text: "JUMP ON · RIDE · JUMP OFF",
      color: COLORS.moving,
    });

    this.spawn(Platform, { x: 3700, y: 475, width: 160, height: 130 });
    this.spawn(Platform, { x: 3900, y: 442, width: 120, height: 196 });
    this.spawn(Sign, {
      x: 3710,
      y: 255,
      text: "HOLD G + JUMP TOWARD THE EDGE\nLedgeProbe checks the route\nThe example supplies the climb move",
      color: COLORS.moving,
    });
    this.spawn(Platform, { x: 4250, y: 400, width: 40, height: 280 });
    this.spawn(Sign, {
      x: 4220,
      y: 220,
      text: "HOLD TOWARD WALL\nJump, then jump again",
    });
    // Supports are spawned first so their planned velocity is ready for riders.
    this.spawn(Hud, { camera });
  }
}
