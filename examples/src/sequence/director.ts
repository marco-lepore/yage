import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { ProcessSlot } from "@yagejs/core";
import { TextComponent } from "@yagejs/renderer";
import {
  SequenceClip,
  SequenceComponent,
  validateSequenceTargets,
} from "@yagejs-addons/sequence";
import type { SequenceTargets } from "@yagejs-addons/sequence";
import type { ActorEntity } from "./actor.js";
import { GREETING_HOLD, Gesture, STAGE } from "./constants.js";
import workspace from "./entrance.yage-sequence-workspace.json";

/** The workspace's runtime clip. The game never loads its preview placements. */
const ENTRANCE = workspace.sequence;

// ---------------------------------------------------------------------------
// Director — plays clips on the scene's actors
// ---------------------------------------------------------------------------

/**
 * Plays a clip on the scene's actors and holds playback while an actor
 * greets. Needs a `SequenceComponent` and a `ProcessComponent` on its entity;
 * `DirectorEntity` adds both.
 */
export class Director extends Component {
  private readonly sequence = this.sibling(SequenceComponent);
  private readonly processes = this.sibling(ProcessComponent);
  /** Running while playback waits after a greeting. */
  private greeting!: ProcessSlot;
  private clip: SequenceClip | undefined;

  constructor(
    private readonly actors: Readonly<Record<string, ActorEntity>>,
    private readonly status: TextComponent,
  ) {
    super();
  }

  onAdd(): void {
    const player = this.sequence.player;
    this.greeting = this.processes.slot({
      duration: GREETING_HOLD,
      onComplete: () => player.resume(),
    });
    // Gestures bubble up from the actors. A greeting pauses the clip, the way
    // a cutscene waits while a line of dialogue is on screen.
    this.listenScene(Gesture, ({ name }) => {
      if (name !== "hello") return;
      player.pause();
      this.greeting.restart();
    });
  }

  /**
   * Play a runtime clip, the entrance by default. Throws before anything
   * changes when the clip is invalid, or when it names a slot, property or
   * event the actors do not provide.
   */
  play(data: unknown = ENTRANCE): void {
    const clip = new SequenceClip(data);
    const targets = this.targets();
    validateSequenceTargets(clip, targets);
    this.start(clip, targets);
  }

  /** Play the current clip again from its first frame. */
  replay(): void {
    if (this.clip) this.start(this.clip, this.targets());
  }

  update(): void {
    const player = this.sequence.player;
    const hold = this.greeting.running ? " for a greeting" : "";
    const duration = this.clip?.document.duration ?? 0;
    this.status.setText(
      `${player.state}${hold} · frame ${Math.floor(player.frame)} / ${duration}`,
    );
  }

  private start(clip: SequenceClip, targets: SequenceTargets): void {
    this.sequence.player.cancel();
    this.greeting.cancel();
    // An actor without a slot in the clip leaves the stage.
    for (const [id, actor] of Object.entries(this.actors)) {
      actor.setActive(Object.hasOwn(clip.document.targets, id));
      actor.reset();
    }
    this.clip = clip;
    this.sequence.player.play(clip, { targets, rect: STAGE });
  }

  private targets(): SequenceTargets {
    return Object.fromEntries(
      Object.entries(this.actors).map(([id, actor]) => [
        id,
        actor.sequenceTarget(),
      ]),
    );
  }
}

// ---------------------------------------------------------------------------
// DirectorEntity — clip playback and the status line under the stage
// ---------------------------------------------------------------------------

/** Spawn key of the director entity, for `scene.findByKey`. */
export const DIRECTOR_KEY = "director";

/** Hosts clip playback, with a line under the stage that shows its state. */
export class DirectorEntity extends Entity {
  /** Clip playback, hosted on this entity. */
  director!: Director;

  setup(params: { actors: Readonly<Record<string, ActorEntity>> }): void {
    // The entity has no Transform, so the line's position is in screen pixels.
    const line = this.spawnChild("status");
    line.add(
      new Transform({
        position: new Vec2(STAGE.x, STAGE.y + STAGE.height + 16),
      }),
    );
    const status = line.add(
      new TextComponent({
        text: "",
        style: { fontFamily: "monospace", fontSize: 14, fill: 0x9fb4d0 },
      }),
    );
    this.add(new SequenceComponent());
    this.add(new ProcessComponent());
    this.director = this.add(new Director(params.actors, status));
  }
}
