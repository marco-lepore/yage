import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { defineLevelEntity, defineParams, param } from "@yagejs/level";
import type { ParamsOf } from "@yagejs/level";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import {
  combineSequenceTargets,
  sequenceEvent,
  transformSequenceTarget,
} from "@yagejs-addons/sequence";
import type { SequenceTarget } from "@yagejs-addons/sequence";
import { visualSequenceTarget } from "@yagejs-addons/sequence/renderer";
import { Gesture } from "./constants.js";

// ---------------------------------------------------------------------------
// Speech — the gesture's consequence: the actor says it
// ---------------------------------------------------------------------------

/** Shows the actor's latest gesture in its caption, and its name before any. */
export class Speech extends Component {
  constructor(
    private readonly actorName: string,
    private readonly caption: TextComponent,
  ) {
    super();
  }

  onAdd(): void {
    this.listen(this.entity, Gesture, ({ name }) => this.caption.setText(name));
  }

  /** Show the actor's name again. */
  reset(): void {
    this.caption.setText(this.actorName);
  }
}

// ---------------------------------------------------------------------------
// ActorProbe — what the e2e path reads
// ---------------------------------------------------------------------------

/** The actor's pose and the gestures it made, readable through Inspector. */
export class ActorProbe extends Component {
  readonly events: { name: string; x: number; y: number; rotation: number }[] =
    [];

  onAdd(): void {
    // Record the pose each gesture happened at.
    this.listen(this.entity, Gesture, ({ name }) => {
      const t = this.entity.get(Transform);
      this.events.push({
        name,
        x: t.worldPosition.x,
        y: t.worldPosition.y,
        rotation: t.rotation,
      });
    });
  }

  /** Forget the gestures of an earlier play. */
  clear(): void {
    this.events.length = 0;
  }

  get x(): number {
    return this.entity.get(Transform).worldPosition.x;
  }
  get y(): number {
    return this.entity.get(Transform).worldPosition.y;
  }
  get opacity(): number {
    return this.entity.get(GraphicsComponent).alpha;
  }
  get scaleX(): number {
    return this.entity.get(Transform).scale.x;
  }
  get scaleY(): number {
    return this.entity.get(Transform).scale.y;
  }
  get rotation(): number {
    return this.entity.get(Transform).rotation;
  }
}

// ---------------------------------------------------------------------------
// ActorEntity — previewed by the editor, animated by the game
// ---------------------------------------------------------------------------

const actorParams = defineParams({
  name: param.string("Actor"),
  color: param.color("#8be9cd"),
  width: param.number(48, { min: 1 }),
  height: param.number(68, { min: 1 }),
});

/**
 * An actor the editor's Sequence mode previews and the game plays the same
 * clip on. `static level` makes it a project entity the editor can place.
 */
export class ActorEntity extends Entity {
  static readonly level = defineLevelEntity({
    id: "example.sequence-actor",
    version: 1,
    params: actorParams,
  });

  setup(p: ParamsOf<typeof actorParams>): void {
    this.add(new Transform());
    // The origin, where a clip places the actor, is the bottom centre.
    this.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(-p.width / 2, -p.height, p.width, p.height, 10).fill(
          p.color,
        );
        g.circle(-p.width / 5, -p.height * 0.7, 3).fill(0x122036);
        g.circle(p.width / 5, -p.height * 0.7, 3).fill(0x122036);
        g.circle(0, 0, 3).fill(0xffffff);
      }),
    );
    const label = this.spawnChild("caption");
    label.add(
      new Transform({ position: new Vec2(-p.width / 2, -p.height - 24) }),
    );
    const caption = label.add(
      new TextComponent({
        text: p.name,
        style: { fontFamily: "monospace", fontSize: 14, fill: p.color },
      }),
    );
    this.add(new Speech(p.name, caption));
    this.add(new ActorProbe());
  }

  /** Forget an earlier play: the caption shows the name, the probe empties. */
  reset(): void {
    this.get(Speech).reset();
    this.get(ActorProbe).clear();
  }

  /**
   * What a clip slot binds to. The transform and visual targets cover the six
   * properties a new editor actor declares; the clip also declares a
   * `gesture` event, which this target turns into an entity event.
   */
  sequenceTarget(): SequenceTarget {
    return combineSequenceTargets(
      transformSequenceTarget(this),
      visualSequenceTarget(this.get(GraphicsComponent)),
      {
        properties: {},
        events: {
          gesture: sequenceEvent(
            { name: { kind: "enum", values: ["hello", "ready"] } },
            ({ name }) => this.emit(Gesture, { name }),
          ),
        },
      },
    );
  }
}
