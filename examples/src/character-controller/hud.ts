import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  type CameraEntity,
  type ColorValue,
} from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import {
  PlatformerDashedEvent,
  PlatformerDroppedEvent,
  PlatformerJumpedEvent,
  PlatformerSlidEvent,
} from "@yagejs-addons/character-controller";
import {
  FLOOR_Y,
  HUD_LAYER,
  PRESETS,
  STATIONS,
  type PresetName,
} from "./constants.js";
import { PlayerEntity } from "./player.js";

/** The HUD texts `Playground` writes to. */
interface HudTexts {
  settings: TextComponent;
  status: TextComponent;
  route: TextComponent;
}

/**
 * The playground's state: the zone the player respawns at, the movement
 * preset, whether dashes are allowed, and the last move. It owns the player
 * and spawns a new one when a setting that shapes the character changes.
 */
export class Playground extends Component {
  private readonly input = this.service(InputManagerKey);
  private player!: PlayerEntity;
  private station = 0;
  private preset: PresetName = "default";
  private _dashAllowed = true;
  private lastMove = "none yet";

  constructor(
    private readonly texts: HudTexts,
    private readonly camera: CameraEntity,
  ) {
    super();
  }

  /** Read by the player's admission policy each time a dash could start. */
  get dashAllowed(): boolean {
    return this._dashAllowed;
  }

  onAdd(): void {
    this.player = this.spawnPlayer();
    // The character emits its move events on itself; they bubble to the scene.
    this.listenScene(PlatformerJumpedEvent, ({ kind }) => {
      this.lastMove = `${kind} jump`;
    });
    this.listenScene(PlatformerDashedEvent, () => {
      this.lastMove = "dash";
    });
    this.listenScene(PlatformerSlidEvent, () => {
      this.lastMove = "slide";
    });
    this.listenScene(PlatformerDroppedEvent, () => {
      this.lastMove = "drop through";
    });
  }

  update(): void {
    const input = this.input;
    if (input.isJustPressed("next")) {
      this.station = (this.station + 1) % STATIONS.length;
      this.respawn();
    }
    if (input.isJustPressed("previous")) {
      this.station = (this.station + STATIONS.length - 1) % STATIONS.length;
      this.respawn();
    }
    if (input.isJustPressed("default")) {
      this.preset = "default";
      this.respawn();
    }
    if (input.isJustPressed("nimble")) {
      this.preset = "nimble";
      this.respawn();
    }
    if (input.isJustPressed("reset")) this.respawn();
    if (input.isJustPressed("policy")) this._dashAllowed = !this._dashAllowed;
    const player = this.player;
    const { admission, body, controller, stance } = player.character;
    if (input.isJustPressed("refill")) admission.refillAirCharges();
    this.refresh(player, {
      x: body.positionX,
      grounded: controller.grounded,
      pose: player.ledge.active
        ? player.ledge.hanging
          ? "hanging"
          : "climbing"
        : stance.crouched
          ? "crouched"
          : "standing",
    });
  }

  private refresh(
    player: PlayerEntity,
    state: { x: number; grounded: boolean; pose: string },
  ): void {
    const preset = PRESETS[this.preset];
    const tuning = player.config;
    const airJumps = `${tuning.airJumps} air jump${tuning.airJumps === 1 ? "" : "s"}`;
    this.texts.settings.setText(
      `${this.preset === "default" ? 1 : 2}  ${preset.label}  ·  run ${tuning.runSpeed} / jump ${tuning.jumpSpeed} / ${airJumps}    |    Dashes: ${this._dashAllowed ? "allowed" : "blocked"} (F)`,
    );
    const { jumps, dashes } = player.character.admission.airCharges;
    this.texts.status.setText(
      `${state.grounded ? "GROUNDED" : "AIRBORNE"}  ·  ${state.pose}  ·  Air charges: ${jumps} jump / ${dashes} dash (C refills)  ·  Last move: ${this.lastMove}`,
    );
    const zone = Math.max(
      0,
      STATIONS.findLastIndex(({ x }) => x <= state.x + 10),
    );
    this.texts.route.setText(
      `Zone ${zone + 1} / ${STATIONS.length}  ${STATIONS[zone]?.name ?? ""}    |    [ / ] previous / next zone  ·  R respawn`,
    );
  }

  private respawn(): void {
    this.player.destroy();
    this.player = this.spawnPlayer();
    this.lastMove = "none yet";
  }

  private spawnPlayer(): PlayerEntity {
    return this.scene.spawn(PlayerEntity, {
      position: { x: STATIONS[this.station]?.x ?? 0, y: FLOOR_Y - 10 },
      tuning: PRESETS[this.preset].tuning,
      playground: this,
      camera: this.camera,
    });
  }
}

/** The settings panel at the top of the screen. Hosts the playground's state. */
export class HudEntity extends Entity {
  playground!: Playground;

  setup({ camera }: { camera: CameraEntity }): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent({ layer: HUD_LAYER }).draw((g) => {
        g.roundRect(16, 14, 928, 132, 12).fill({ color: 0x18243a });
      }),
    );
    const title = this.spawnHudText("title", new Vec2(28, 25), 17, 0x5eead4);
    title.setText("CHARACTER CONTROLLER  /  MOVEMENT PLAYGROUND");
    const settings = this.spawnHudText(
      "settings",
      new Vec2(28, 58),
      13,
      0xe2e8f0,
    );
    const status = this.spawnHudText("status", new Vec2(28, 87), 13, 0x94a3b8);
    const route = this.spawnHudText("route", new Vec2(28, 118), 12, 0xc4b5fd);
    this.playground = this.add(
      new Playground({ settings, status, route }, camera),
    );
  }

  /** One line of text as a child entity, in screen pixels. */
  private spawnHudText(
    name: string,
    position: Vec2,
    fontSize: number,
    fill: ColorValue,
  ): TextComponent {
    const child = this.spawnChild(name);
    child.add(new Transform({ position }));
    return child.add(
      new TextComponent({
        layer: HUD_LAYER,
        text: "",
        style: { fontFamily: "monospace", fontSize, fill },
      }),
    );
  }
}
