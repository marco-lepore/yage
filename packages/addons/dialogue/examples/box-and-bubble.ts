/**
 * Canonical, copy-pasteable example for @yagejs-addons/dialogue.
 *
 * Zero bundled assets: it uses `defaultTheme()` (Graphics chrome + canvas text)
 * and `createMixedDialogue`, which routes each line/choice to either the bottom
 * box (`view: "box"`, the default) or a world-space speech bubble over the
 * speaking actor (`view: "bubble"`). One short script shows, in order:
 *
 *   • a box line,
 *   • a `[wave]` / `[shake]` per-glyph effect,
 *   • a bubble line spoken by an in-world actor,
 *   • a branching choice that advances the conversation.
 *
 * Controls: the default keyboard binding plus pointer (tap / hover). Press the
 * `interact` action (Enter / Space) to advance / reveal-all / confirm; arrow
 * keys move the choice cursor; the mouse can hover + click choices.
 *
 * Headless vs presenters split: the runner, controller, events, and input
 * bindings come from the root entry (`@yagejs-addons/dialogue`, pixi-free); the
 * presenters + theme come from the `/presenters` subpath.
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

const WIDTH = 800;
const HEIGHT = 600;

// ── the dialogue script ────────────────────────────────────────────────────
// `view` routes each step: the narrator talks in the bottom box; "guide" talks
// in a bubble over its in-world actor. Markup ([wave]/[shake]) is parsed
// by the headless core and interpreted by the presenters.
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
          text: "It can [shake]shout[/shake], and it knows about the [b]mana[/b] system.",
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
          text: "Branching, choices, effects — all from one script.",
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

// ── a tiny in-world actor for the bubble speaker ────────────────────────────
// `DialogueActor` self-registers under its logical speaker id so the bubble
// presenter can anchor to it. The `anchor` offset lifts the bubble to its head.
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

/**
 * Inspector-readable record of what the conversation surfaced. The e2e reads
 * this with `inspector.getComponentData("dialogue-host", "DialogueProbe")`.
 */
class DialogueProbe extends Component {
  lastLine = "";
  lineCount = 0;
  lastChoice = "";
  ended = false;

  onLine(text: string): void {
    this.lastLine = text;
    this.lineCount++;
  }
  onChoiceMade(text: string): void {
    this.lastChoice = text;
  }
  onEnded(): void {
    this.ended = true;
  }

  serialize(): {
    lastLine: string;
    lineCount: number;
    lastChoice: string;
    ended: boolean;
  } {
    return {
      lastLine: this.lastLine,
      lineCount: this.lineCount,
      lastChoice: this.lastChoice,
      ended: this.ended,
    };
  }
}

class DialogueScene extends Scene {
  readonly name = "dialogue-addon";
  // Opt into the dialogue render layers (frame / avatar / text) for the box,
  // plus a world-space layer for the bubble: bubbles position via
  // actor.anchorWorld() and hit-test in world space, so a screen-space layer
  // only appears to work while the camera transform is identity.
  readonly layers = [
    { name: "bubble-world", order: 50, space: "world" } as const,
    ...DIALOGUE_LAYERS,
  ];

  private controller!: DialogueController;

  onEnter(): void {
    const cam = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
    });
    this.context.resolve(InputManagerKey).setCamera(cam);

    // The in-world bubble speaker.
    const guide = this.spawn("guide-entity");
    guide.add(
      new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2 - 40) }),
    );
    guide.add(new Guide());

    // Build the presenter bundle from the zero-asset default theme. `mixed`
    // gives both a bottom box AND a world bubble, routed per-line by `view`.
    const bundle = createMixedDialogue(defaultTheme(), {
      worldLayer: "bubble-world",
    });

    // A small probe component the e2e reads via the Inspector.
    const host: Entity = this.spawn("dialogue-host");
    const probe = host.add(new DialogueProbe());

    // The controller is a Component. `fullControls(bundle.choices)` adds pointer
    // hover/tap on top of the keyboard binding; passing the choices presenter
    // lets it hit-test rows.
    this.controller = host.add(
      new DialogueController({
        ...bundle,
        input: fullControls(bundle.choices),
      }),
    );

    // Observe the conversation. The host entity emits these; events bubble to
    // the scene, so `this.on(...)` would work too.
    host.on(DialogueLineEvent, (e) => probe.onLine(e.text));
    host.on(DialogueChoiceMadeEvent, (e) => probe.onChoiceMade(e.text));
    host.on(DialogueEndedEvent, () => probe.onEnded());

    this.controller.play(SCRIPT);
  }

  onExit(): void {
    this.context.resolve(InputManagerKey).clearCamera();
  }
}

// ── boot ────────────────────────────────────────────────────────────────────
export async function start(container: HTMLElement): Promise<Engine> {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container,
    }),
  );
  // The dialogue keyboard binding polls the `interact` / `move-up` / `move-down`
  // action map; map them so the default binding has something to read.
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
  return engine;
}

export { DialogueScene, DialogueProbe, SCRIPT, WIDTH, HEIGHT };
