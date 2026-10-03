import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import {
  PlatformerDashedEvent,
  PlatformerJumpedEvent,
  PlatformerSlidEvent,
} from "@yagejs-addons/character-controller/platformer";
import { Player } from "./player.js";

/** Owns the selected preset, game policy, and player lifetime. */
export class Playground extends Component {
  private readonly input = this.service(InputManagerKey);
  private player!: Player;
  nimble = false;
  dashAllowed = true;
  lastMove = "Ready";

  constructor(
    private readonly status: TextComponent,
    private readonly settings: TextComponent,
  ) {
    super();
  }
  onAdd(): void {
    this.respawn();
    this.listenScene(PlatformerJumpedEvent, ({ kind }) => {
      this.lastMove = `${kind} jump`;
    });
    this.listenScene(PlatformerDashedEvent, () => {
      this.lastMove = "dash";
    });
    this.listenScene(PlatformerSlidEvent, () => {
      this.lastMove = "slide";
    });
  }
  get grounded(): boolean {
    return this.player.character.controller.grounded;
  }
  get x(): number {
    return this.player.character.body.positionX;
  }
  get y(): number {
    return this.player.character.body.positionY;
  }
  get airJumps(): number {
    return this.player.character.admission.airCharges.jumps;
  }
  get crouched(): boolean {
    return this.player.character.stance.crouched;
  }

  update(): void {
    if (this.input.isJustPressed("default")) {
      this.nimble = false;
      this.respawn();
    }
    if (this.input.isJustPressed("nimble")) {
      this.nimble = true;
      this.respawn();
    }
    if (this.input.isJustPressed("reset") || this.y > 650) this.respawn();
    if (this.input.isJustPressed("policy"))
      this.dashAllowed = !this.dashAllowed;
    const character = this.player.character;
    if (this.input.isJustPressed("refill"))
      character.admission.refillAirCharges();
    if (this.input.isJustPressed("drop") && this.grounded)
      character.collider.dropThrough(0.3);
    this.settings.setText(
      `${this.nimble ? "2  NIMBLE  ·  run 260 / jump 480 / 2 air jumps" : "1  DEFAULT  ·  run 190 / jump 434 / 1 air jump"}    |    Dash policy: ${this.dashAllowed ? "allowed" : "blocked"}`,
    );
    const { jumps, dashes } = character.admission.airCharges;
    this.status.setText(
      `${this.grounded ? "GROUNDED" : "AIRBORNE"}   •   ${this.crouched ? "crouched" : "standing"}   •   Air charges: ${jumps} jump / ${dashes} dash   •   Last move: ${this.lastMove}`,
    );
  }
  private respawn(): void {
    this.player?.destroy();
    this.player = this.scene.spawn(Player, {
      nimble: this.nimble,
      canDash: () => this.dashAllowed,
    });
    this.lastMove = "Ready";
  }
}

export class Hud extends Entity {
  setup(): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent({ layer: "hud" }).draw((g) => {
        g.roundRect(16, 14, 928, 106, 12).fill({ color: 0x18243a });
      }),
    );
    this.text(
      "title",
      28,
      25,
      "CHARACTER CONTROLLER  /  MOVEMENT PLAYGROUND",
      17,
      0x5eead4,
    );
    const settings = this.text("settings", 28, 58, "", 13, 0xe2e8f0);
    const status = this.text("status", 28, 87, "", 13, 0x94a3b8);
    this.add(new Playground(status, settings));
  }
  private text(
    name: string,
    x: number,
    y: number,
    text: string,
    fontSize: number,
    fill: number,
  ): TextComponent {
    const child = this.spawnChild(name);
    child.add(new Transform({ position: new Vec2(x, y) }));
    return child.add(
      new TextComponent({
        layer: "hud",
        text,
        style: { fontFamily: "monospace", fontSize, fill },
      }),
    );
  }
}
