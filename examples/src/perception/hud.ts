import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import {
  PerceptionDetectedEvent,
  PerceptionForgottenEvent,
  PerceptionLostEvent,
  PerceptionSensor,
} from "@yagejs-addons/perception";
import type { PerceptionEvent } from "@yagejs-addons/perception";
import {
  ARENA_TOP,
  GUARD_KEY,
  HUD_LAYER,
  PLAYER_KEY,
  WIDTH,
} from "./constants.js";
import { Awareness, GuardBrain } from "./guard.js";

// ---------------------------------------------------------------------------
// HudReadout — the guard's state, its memory of the player, and the last event
// ---------------------------------------------------------------------------
class HudReadout extends Component {
  /** The latest perception event, as shown on the third line. */
  lastEvent = "none yet";

  constructor(private readonly text: TextComponent) {
    super();
  }

  onAdd(): void {
    // The guard emits perception events on itself; they bubble to the scene.
    const describe =
      (verb: string) =>
      ({ observation }: PerceptionEvent): void => {
        const target = observation.target.current;
        const name = target ? (target.key ?? target.name) : "a removed target";
        const reason = observation.reason ? ` (${observation.reason})` : "";
        this.lastEvent = `${verb} ${name}${reason}`;
      };
    this.listenScene(PerceptionDetectedEvent, describe("detected"));
    this.listenScene(PerceptionLostEvent, describe("lost"));
    this.listenScene(PerceptionForgottenEvent, describe("forgot"));
  }

  update(): void {
    const guard = this.scene.findByKey(GUARD_KEY);
    const player = this.scene.findByKey(PLAYER_KEY);
    if (!guard || !player) return;
    const sensor = guard.get(PerceptionSensor);
    const sighting = sensor.observationOf(player);
    const memory = sighting?.visible
      ? "in sight"
      : sighting
        ? `hidden, last seen ${(sensor.sampledAt - sighting.lastSeenAt).toFixed(1)} s ago`
        : "not remembered";
    const awareness = Math.round(guard.get(Awareness).level * 100);
    this.text.setText(
      `Guard: ${guard.get(GuardBrain).state}  |  awareness ${awareness}%\n` +
        `Player: ${memory}\n` +
        `Last event: ${this.lastEvent}`,
    );
  }
}

// ---------------------------------------------------------------------------
// HudEntity — in-canvas HUD on the screen-space layer
// ---------------------------------------------------------------------------
/**
 * An opaque panel above the arena with three lines of text. The panel hides
 * the part of the guard's view cone that reaches past the arena's top edge.
 */
export class HudEntity extends Entity {
  setup(): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent({ layer: HUD_LAYER }).draw((g) =>
        g.rect(0, 0, WIDTH, ARENA_TOP - 4).fill(0x121923),
      ),
    );
    const readout = this.spawnChild("readout");
    readout.add(new Transform({ position: new Vec2(22, 18) }));
    const text = readout.add(
      new TextComponent({
        text: "",
        layer: HUD_LAYER,
        style: {
          fontFamily: "monospace",
          fontSize: 15,
          fill: 0xe4eaf2,
          lineHeight: 26,
        },
      }),
    );
    this.add(new HudReadout(text));
  }
}
