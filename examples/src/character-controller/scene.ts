import { Scene } from "@yagejs/core";
import type { LayerDef } from "@yagejs/renderer";
import { COLORS } from "./constants.js";
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
    this.spawn(Platform, { x: 480, y: 570, width: 960, height: 60 });
    this.spawn(Platform, { x: -10, y: 300, width: 20, height: 600 });
    this.spawn(Platform, { x: 970, y: 300, width: 20, height: 600 });
    this.spawn(Platform, { x: 275, y: 486, width: 130, height: 40 });
    this.spawn(Platform, { x: 375, y: 537, width: 30, height: 6 });
    this.spawn(Ramp);
    this.spawn(Platform, { x: 130, y: 452, width: 140, oneWay: true });
    this.spawn(Platform, { x: 300, y: 310, width: 120, oneWay: true });
    this.spawn(Platform, {
      x: 610,
      y: 430,
      width: 96,
      oneWay: true,
      to: { x: 770, y: 330 },
    });
    this.spawn(Platform, { x: 900, y: 400, width: 40, height: 280 });
    this.spawn(Sign, {
      x: 130,
      y: 405,
      text: "ONE-WAY LEDGES\nE to drop through",
      color: COLORS.oneWay,
    });
    this.spawn(Sign, { x: 280, y: 433, text: "RUN, THEN S TO SLIDE" });
    this.spawn(Sign, { x: 452, y: 560, text: "STEPS + SLOPES" });
    this.spawn(Sign, {
      x: 690,
      y: 270,
      text: "MOVING SUPPORT",
      color: COLORS.moving,
    });
    this.spawn(Sign, { x: 850, y: 205, text: "WALL JUMP\nHold toward wall" });
    this.spawn(Sign, {
      x: 105,
      y: 560,
      text: "START  ·  R resets",
      color: COLORS.player,
    });
    this.spawn(Sign, {
      x: 700,
      y: 490,
      text: "SPACE, then SPACE\nTry an air jump",
    });
    // Supports are spawned first so their planned velocity is ready for riders.
    this.spawn(Hud);
  }
}
