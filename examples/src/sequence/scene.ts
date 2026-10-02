import { defineLevelEntity, defineParams, param } from "@yagejs/level";
import {
  Component,
  Entity,
  Scene,
  Transform,
  Vec2,
  defineEvent,
} from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import {
  SequenceClip,
  SequenceComponent,
  combineSequenceTargets,
  transformSequenceTarget,
} from "@yagejs-addons/sequence";
import type { SequenceFrame, SequenceTargets } from "@yagejs-addons/sequence";
import { visualSequenceTarget } from "@yagejs-addons/sequence/renderer";
import workspace from "./entrance.yage-sequence-workspace.json";
const entrance = workspace.sequence;

export const ACTORS = {
  actorA: { name: "Aster", color: 0x8be9cd, width: 48, height: 68 },
  actorB: { name: "Ember", color: 0xffcc6e, width: 72, height: 48 },
};
export const Gesture = defineEvent<{ name: string }>(
  "sequence-example:gesture",
);
export const DEFAULT_FRAME: SequenceFrame = {
  x: 60,
  y: 40,
  width: 840,
  height: 420,
};
/** Readable through Inspector; event consequences remain on the actor. */
export class ActorProbe extends Component {
  readonly events: { name: string; x: number; y: number; rotation: number }[] =
    [];
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly label: TextComponent,
  ) {
    super();
  }
  onAdd(): void {
    this.listen(this.entity, Gesture, ({ name }) => {
      const t = this.entity.get(Transform);
      this.events.push({
        name,
        x: t.worldPosition.x,
        y: t.worldPosition.y,
        rotation: t.rotation,
      });
      this.label.setText(name);
    });
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
const actorParams = defineParams({
  name: param.string("Actor"),
  color: param.color("#8be9cd"),
  width: param.number(48, { min: 1 }),
  height: param.number(68, { min: 1 }),
  placeholder: param.boolean(false),
});
export class ActorEntity extends Entity {
  static readonly level = defineLevelEntity({
    id: "example.sequence-actor",
    version: 1,
    params: actorParams,
  });
  setup(p: {
    name: string;
    color: number;
    width: number;
    height: number;
    placeholder: boolean;
  }): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent().draw((g) => {
        if (p.placeholder)
          g.rect(-p.width / 2, -p.height, p.width, p.height).stroke({
            color: p.color,
            width: 2,
          });
        else {
          g.roundRect(-p.width / 2, -p.height, p.width, p.height, 10).fill(
            p.color,
          );
          g.circle(-p.width / 5, -p.height * 0.7, 3).fill(0x122036);
          g.circle(p.width / 5, -p.height * 0.7, 3).fill(0x122036);
        }
        g.circle(0, 0, 3).fill(0xffffff);
      }),
    );
    const label = this.spawnChild("caption");
    label.add(
      new Transform({ position: new Vec2(-p.width / 2, -p.height - 24) }),
    );
    const text = label.add(
      new TextComponent({
        text: p.name,
        style: { fontFamily: "monospace", fontSize: 14, fill: p.color },
      }),
    );
    this.add(new ActorProbe(p.width, p.height, text));
  }
}
function bind(actor: ActorEntity) {
  return combineSequenceTargets(
    transformSequenceTarget(actor),
    visualSequenceTarget(actor.get(GraphicsComponent)),
    {
      properties: {},
      events: {
        gesture: {
          payload: { name: { kind: "enum", values: ["hello", "ready"] } },
          dispatch: (payload) =>
            actor.emit(Gesture, { name: String(payload.name) }),
        },
      },
    },
  );
}
export class SequenceDemo extends Component {
  private readonly player = this.sibling(SequenceComponent);
  private lastFrame = "";
  private runtimeActors = Object.keys(entrance.targets);
  readonly targets: Record<string, SequenceTargets>;
  constructor(
    private readonly actors: Readonly<Record<string, ActorEntity>>,
    private readonly placeholders: Readonly<Record<string, ActorEntity>>,
    private readonly border: GraphicsComponent,
  ) {
    super();
    this.targets = {
      "Real actors": Object.fromEntries(
        Object.entries(actors).map(([id, actor]) => [id, bind(actor)]),
      ),
      Placeholders: Object.fromEntries(
        Object.entries(placeholders).map(([id, actor]) => [id, bind(actor)]),
      ),
    };
  }
  play(data: unknown = entrance): void {
    const clip = new SequenceClip(data);
    this.player.player.cancel("retain");
    this.runtimeActors = Object.keys(clip.document.targets);
    for (const actor of Object.values(this.actors))
      actor.get(ActorProbe).events.length = 0;
    this.player.player.play(clip, {
      targets: this.targets["Real actors"]!,
      frame: DEFAULT_FRAME,
    });
  }
  update(): void {
    const frame = DEFAULT_FRAME;
    const key = JSON.stringify(frame);
    if (this.lastFrame !== key) {
      this.border.draw((g) => {
        g.clear();
        g.rect(frame.x, frame.y, frame.width, frame.height).stroke({
          color: 0x4c6788,
          width: 2,
        });
      });
      this.lastFrame = key;
    }
    const placeholder = false;
    const ids = this.runtimeActors;
    for (const [id, actor] of Object.entries(this.actors))
      actor.setActive(!placeholder && ids.includes(id));
    for (const [id, actor] of Object.entries(this.placeholders))
      actor.setActive(placeholder && ids.includes(id));
  }
}
class SequenceHost extends Entity {
  setup(params: {
    actors: Readonly<Record<string, ActorEntity>>;
    placeholders: Readonly<Record<string, ActorEntity>>;
    border: GraphicsComponent;
  }): void {
    this.add(new SequenceComponent());
    this.add(
      new SequenceDemo(params.actors, params.placeholders, params.border),
    );
  }
}
export class SequenceScene extends Scene {
  readonly name = "sequence";
  onEnter(): void {
    const border = this.spawn("frame").add(new GraphicsComponent());
    const actors = Object.fromEntries(
      Object.entries(ACTORS).map(([id, actor]) => [
        id,
        this.spawn(ActorEntity, { ...actor, placeholder: false }, { key: id }),
      ]),
    );
    const placeholders = Object.fromEntries(
      Object.entries(ACTORS).map(([id, actor]) => [
        id,
        this.spawn(
          ActorEntity,
          { ...actor, name: id, placeholder: true },
          { key: `placeholder-${id}` },
        ),
      ]),
    );
    this.spawn(
      SequenceHost,
      { actors, placeholders, border },
      { key: "sequence-host" },
    );
  }
}
