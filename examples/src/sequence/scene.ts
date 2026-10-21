import { Scene, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { ActorEntity } from "./actor.js";
import { ACTORS, STAGE } from "./constants.js";
import { DIRECTOR_KEY, DirectorEntity } from "./director.js";

// ---------------------------------------------------------------------------
// SequenceScene
// ---------------------------------------------------------------------------
export class SequenceScene extends Scene {
  readonly name = "sequence";

  // The scene only assembles the stage. The director plays the clips.
  onEnter(): void {
    this.drawStage();
    const actors = Object.fromEntries(
      Object.entries(ACTORS).map(([id, actor]) => [
        id,
        this.spawn(ActorEntity, actor, { key: id }),
      ]),
    );
    this.spawn(DirectorEntity, { actors }, { key: DIRECTOR_KEY });
  }

  /** The rectangle the clip's authored size is placed in, with its label. */
  private drawStage(): void {
    const stage = this.spawn("stage");
    stage.add(new Transform());
    stage.add(
      new GraphicsComponent().draw((g) => {
        g.rect(STAGE.x, STAGE.y, STAGE.width, STAGE.height).stroke({
          color: 0x4c6788,
          width: 2,
        });
      }),
    );
    const label = stage.spawnChild("label");
    label.add(new Transform({ position: new Vec2(STAGE.x, STAGE.y - 22) }));
    label.add(
      new TextComponent({
        text: `rect: ${STAGE.width} × ${STAGE.height} at (${STAGE.x}, ${STAGE.y})`,
        style: { fontFamily: "monospace", fontSize: 13, fill: 0x4c6788 },
      }),
    );
  }
}
