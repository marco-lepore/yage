/**
 * Deterministic e2e fixture for @yagejs-addons/dialogue.
 *
 * Boots a tiny scene with `createMixedDialogue(defaultTheme())` (zero assets),
 * freezes the clock, and exposes the controller on `window.__dialogue__` so the
 * spec can drive it (`advance()` / `choose()`) deterministically. All assertions
 * go through a `DialogueProbe` component read via the Inspector API
 * (`getComponentData("dialogue-host", "DialogueProbe")`) — including a
 * `choosing` flag the probe tracks from the addon's own choice-shown /
 * choice-made events, so the spec never depends on a specific method surface of
 * the controller.
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
import { DebugPlugin } from "@yagejs/debug";
import {
  DialogueController,
  DialogueLineEvent,
  DialogueChoiceShownEvent,
  DialogueChoiceMadeEvent,
  DialogueEndedEvent,
  type DialogueScript,
} from "@yagejs-addons/dialogue";
import {
  defaultTheme,
  createMixedDialogue,
  DialogueActor,
  DIALOGUE_LAYERS,
} from "@yagejs-addons/dialogue/presenters";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const container = setupContainer(WIDTH, HEIGHT);

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
          text: "It knows about the [term=mana]mana[/term] system.",
        },
        {
          kind: "say",
          speaker: "guide",
          view: "bubble",
          text: "Down here, I speak from a bubble.",
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
        { kind: "say", speaker: "narrator", text: "Branching works." },
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

class Guide extends Component {
  onAdd(): void {
    this.entity.add(
      new GraphicsComponent().draw((g) =>
        g.circle(0, 0, 18).fill({ color: 0x7ec8ff }),
      ),
    );
    this.entity.add(
      new DialogueActor({ speaker: "guide", anchor: { x: 0, y: -28 } }),
    );
  }
}

/**
 * Inspector-readable record of what the conversation has surfaced so far. It
 * derives `choosing` purely from the addon's own events (choice-shown sets it,
 * choice-made / end clears it), so the spec can poll it through the Inspector
 * without calling any controller method.
 */
class DialogueProbe extends Component {
  lastLine = "";
  lineCount = 0;
  lastChoice = "";
  choiceCount = 0;
  choosing = false;
  ended = false;

  onLine(text: string): void {
    this.lastLine = text;
    this.lineCount++;
  }
  onChoiceShown(): void {
    this.choosing = true;
  }
  onChoiceMade(text: string): void {
    this.lastChoice = text;
    this.choiceCount++;
    this.choosing = false;
  }
  onEnded(): void {
    this.ended = true;
    this.choosing = false;
  }

  serialize(): {
    lastLine: string;
    lineCount: number;
    lastChoice: string;
    choiceCount: number;
    choosing: boolean;
    ended: boolean;
  } {
    return {
      lastLine: this.lastLine,
      lineCount: this.lineCount,
      lastChoice: this.lastChoice,
      choiceCount: this.choiceCount,
      choosing: this.choosing,
      ended: this.ended,
    };
  }
}

class DialogueScene extends Scene {
  readonly name = "dialogue-addon-scene";
  readonly layers = [...DIALOGUE_LAYERS];

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
    const controller = host.add(new DialogueController(bundle));

    host.on(DialogueLineEvent, (e) => probe.onLine(e.text));
    host.on(DialogueChoiceShownEvent, () => probe.onChoiceShown());
    host.on(DialogueChoiceMadeEvent, (e) => probe.onChoiceMade(e.text));
    host.on(DialogueEndedEvent, () => probe.onEnded());

    controller.play(SCRIPT);

    // Expose the controller so the spec can drive it deterministically. `advance`
    // and `choose` are part of the controller's public host API; assertions read
    // the Inspector-visible DialogueProbe, not the controller directly.
    (window as unknown as { __dialogue__: DialogueController }).__dialogue__ =
      controller;
  }

  onExit(): void {
    this.context.resolve(InputManagerKey).clearCamera();
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container,
  }),
);
engine.use(new InputPlugin({ actions: { interact: ["Enter"] } }));
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new DialogueScene());
