/**
 * @yagejs-addons/dialogue — box + bubble demo (the first YAGE addon).
 *
 * Zero bundled assets: `defaultTheme()` (Graphics chrome + canvas text) wired
 * through `createMixedDialogue`, which routes each line/choice to the bottom box
 * (`view: "box"`, default) or a world-space speech bubble over the speaking
 * actor (`view: "bubble"`). Shows a box line, `[wave]`/`[shake]` per-glyph
 * effects, a `[term=…]` glossary span (highlight + hit-test → `onTermActivate`),
 * a bubble line over an in-world `DialogueActor`, and a branching choice.
 *
 * Export split: runner / controller / events / input bindings come from the
 * pixi-free root entry (`@yagejs-addons/dialogue`); presenters + theme come from
 * the `/presenters` subpath.
 */

import {
  Engine,
  Scene,
  Component,
  Transform,
  Vec2,
  type Entity,
} from "@yagejs/core";
import {
  RendererPlugin,
  CameraEntity,
  GraphicsComponent,
} from "@yagejs/renderer";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import {
  DialogueController,
  DialogueLineEvent,
  DialogueChoiceMadeEvent,
  DialogueTermActivatedEvent,
  DialogueEndedEvent,
  fullControls,
  type DialogueScript,
} from "@yagejs-addons/dialogue";
import {
  defaultTheme,
  createMixedDialogue,
  DialogueActor,
  DIALOGUE_LAYERS,
} from "@yagejs-addons/dialogue/presenters";
import { setupGameContainer } from "./shared.js";

const WIDTH = 800;
const HEIGHT = 600;

const SCRIPT: DialogueScript = {
  id: "demo",
  start: "intro",
  speakers: {
    narrator: { id: "narrator", name: "Narrator", color: 0xffd866 },
    guide: { id: "guide", name: "Guide", color: 0x7ec8ff },
  },
  nodes: {
    intro: {
      id: "intro",
      steps: [
        {
          kind: "say",
          speaker: "narrator",
          text: "Welcome to the [wave]dialogue[/wave] addon.",
        },
        {
          kind: "say",
          speaker: "narrator",
          text: "It can [shake]shout[/shake], and it knows about the [term=mana]mana[/term] system.",
        },
        {
          kind: "say",
          speaker: "guide",
          view: "bubble",
          text: "Down here, I speak from a bubble that follows me.",
        },
        {
          kind: "choice",
          speaker: "narrator",
          text: "What would you like to do?",
          options: [
            { text: "Tell me more", target: "more" },
            { text: "That's all", target: "done" },
          ],
        },
      ],
    },
    more: {
      id: "more",
      steps: [
        {
          kind: "say",
          speaker: "narrator",
          text: "Branching, choices, effects, glossary terms — all from one script.",
        },
        { kind: "goto", target: "done" },
      ],
    },
    done: {
      id: "done",
      steps: [
        { kind: "say", speaker: "narrator", text: "Goodbye!" },
        { kind: "end" },
      ],
    },
  },
};

/** In-world bubble speaker: a dot that self-registers as the `guide` actor. */
class Guide extends Component {
  onAdd(): void {
    this.entity.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 18).fill({ color: 0x7ec8ff });
        g.circle(0, 0, 18).stroke({ color: 0xffffff, width: 2, alpha: 0.6 });
      }),
    );
    this.entity.add(
      new DialogueActor({ speaker: "guide", anchor: { x: 0, y: -28 } }),
    );
  }
}

/** Inspector-readable record of what the conversation surfaced (for the e2e). */
class DialogueProbe extends Component {
  lastLine = "";
  lineCount = 0;
  lastChoice = "";
  lastTerm = "";
  ended = false;

  onLine(text: string): void {
    this.lastLine = text;
    this.lineCount++;
  }
  onChoiceMade(text: string): void {
    this.lastChoice = text;
  }
  onTerm(term: string): void {
    this.lastTerm = term;
  }
  onEnded(): void {
    this.ended = true;
  }

  serialize(): {
    lastLine: string;
    lineCount: number;
    lastChoice: string;
    lastTerm: string;
    ended: boolean;
  } {
    return {
      lastLine: this.lastLine,
      lineCount: this.lineCount,
      lastChoice: this.lastChoice,
      lastTerm: this.lastTerm,
      ended: this.ended,
    };
  }
}

class DialogueScene extends Scene {
  readonly name = "dialogue-addon";
  readonly layers = [...DIALOGUE_LAYERS];

  private controller!: DialogueController;

  onEnter(): void {
    const cam = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
    });
    this.context.resolve(InputManagerKey).setCamera(cam);

    const guide = this.spawn("guide-entity");
    guide.add(
      new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2 - 40) }),
    );
    guide.add(new Guide());

    const bundle = createMixedDialogue(defaultTheme(), {
      worldLayer: DIALOGUE_LAYERS[0]!.name,
    });

    const host: Entity = this.spawn("dialogue-host");
    const probe = host.add(new DialogueProbe());

    this.controller = host.add(
      new DialogueController({
        ...bundle,
        input: fullControls(bundle.choices),
        // The addon only emits the opaque term id (+ screen pos + hover/tap kind);
        // the game owns the tooltip. Here we just record the id for the demo.
        onTermActivate: (e) => probe.onTerm(e.id),
      }),
    );

    host.on(DialogueLineEvent, (e) => probe.onLine(e.text));
    host.on(DialogueChoiceMadeEvent, (e) => probe.onChoiceMade(e.text));
    host.on(DialogueTermActivatedEvent, (e) => probe.onTerm(e.id));
    host.on(DialogueEndedEvent, () => probe.onEnded());

    this.controller.play(SCRIPT);
  }

  onExit(): void {
    this.context.resolve(InputManagerKey).clearCamera();
  }
}

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        interact: ["Enter", "Space"],
        "move-up": ["ArrowUp", "KeyW"],
        "move-down": ["ArrowDown", "KeyS"],
        attack: ["ShiftLeft"],
      },
      preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown"],
    }),
  );

  await engine.start();
  await engine.scenes.push(new DialogueScene());
}

main().catch(console.error);
