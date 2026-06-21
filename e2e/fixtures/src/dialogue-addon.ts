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
import { Texture } from "pixi.js";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import {
  DialogueController,
  DialogueLineEvent,
  DialogueChoiceShownEvent,
  DialogueChoiceMadeEvent,
  DialogueSelectionChangedEvent,
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

/** A synchronous 48×48 nine-slice frame (8px border) for the textured
 *  `meta.chrome` scenario — drawn on a canvas so it resolves immediately, with
 *  no async asset load to race the chrome mount. */
function makeFrameTexture(): Texture {
  const size = 48;
  const border = 8;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#b89a5e"; // border
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#2a2418"; // center
    ctx.fillRect(border, border, size - 2 * border, size - 2 * border);
  }
  return Texture.from(canvas);
}

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
          text: "It knows about the [b]mana[/b] system.",
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
            // A visible-but-disabled row: its condition is always false and its
            // presentation is "disabled", so it shows greyed-out and the Session
            // refuses to select or commit it.
            {
              text: "Locked path",
              target: "more",
              condition: { kind: "literal", value: false },
              presentation: "disabled",
              disabledReason: "Needs a key",
            },
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

/** Overflow: a single choice with nine options. The spec navigates through all
 *  nine and commits the last to prove the grown list stays usable. */
const HUB_SCRIPT: DialogueScript = {
  id: "hub",
  start: "hub",
  nodes: {
    hub: {
      id: "hub",
      steps: [
        {
          kind: "choice",
          text: "Pick a door (there are many):",
          options: Array.from({ length: 9 }, (_, i) => ({
            text: `Door number ${i + 1}`,
            target: "out",
          })),
        },
      ],
    },
    out: { id: "out", steps: [{ kind: "say", text: "Through it." }, { kind: "end" }] },
  },
};

/** Per-line `meta.chrome` swaps the box frame style — a named textured
 *  nine-slice, the built-in invisible "none", then back to the drawn default. */
const TEXTURED_SCRIPT: DialogueScript = {
  id: "textured",
  start: "t",
  speakers: { narrator: { id: "narrator", name: "Narrator", color: 0xffd866 } },
  nodes: {
    t: {
      id: "t",
      steps: [
        { kind: "say", speaker: "narrator", text: "Parchment frame here.", meta: { chrome: "parchment" } },
        { kind: "say", speaker: "narrator", text: "No frame at all.", meta: { chrome: "none" } },
        { kind: "say", speaker: "narrator", text: "Back to the default frame." },
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
  /** Labels of the options on the current/last choice (includes disabled). */
  shownOptions: readonly string[] = [];
  /** Original option index of the last selection-changed event (nav/hover). */
  selectionIndex = -1;

  onLine(text: string): void {
    this.lastLine = text;
    this.lineCount++;
  }
  onChoiceShown(options: readonly string[]): void {
    this.choosing = true;
    this.shownOptions = options;
    this.selectionIndex = -1; // reset per menu
  }
  onSelectionChanged(index: number): void {
    this.selectionIndex = index;
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
    shownOptions: readonly string[];
    selectionIndex: number;
    boxVisible: boolean;
    bubbleVisible: boolean;
    texturedVisible: boolean;
  } {
    return {
      lastLine: this.lastLine,
      lineCount: this.lineCount,
      lastChoice: this.lastChoice,
      choiceCount: this.choiceCount,
      choosing: this.choosing,
      ended: this.ended,
      shownOptions: this.shownOptions,
      selectionIndex: this.selectionIndex,
      // Live chrome visibility (read straight off the renderer) so the spec can
      // lock the regression: after a hide/restore on a bubble line, the bubble must come
      // back and the box frame must stay hidden.
      boxVisible: this.frameVisible("dlg-frame"),
      bubbleVisible: this.frameVisible("dlg-bubble"),
      // The nine-slice host shows only while a textured `meta.chrome` style is
      // the active box frame — so the spec can watch the style swap.
      texturedVisible: this.frameVisible("dlg-frame-tex"),
    };
  }

  /** Whether the named chrome entity's Graphics is currently visible. */
  private frameVisible(name: string): boolean {
    return this.scene.findEntity(name)?.tryGet(GraphicsComponent)?.graphics.visible ?? false;
  }
}

class DialogueScene extends Scene {
  readonly name = "dialogue-addon-scene";
  // Bubbles position via actor.anchorWorld() and hit-test in world space, so
  // they need a real world-space layer — the screen-space DIALOGUE_LAYERS only
  // appear to work while the camera transform is identity.
  readonly layers = [
    { name: "bubble-world", order: 50, space: "world" } as const,
    ...DIALOGUE_LAYERS,
  ];

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

    // A named textured style ("parchment") — but NO "default" style, so the
    // main script's box lines keep the drawn Graphics frame (and the existing
    // specs that read `boxVisible`). The `meta.chrome` script opts in per line.
    const theme = {
      ...defaultTheme(),
      textured: {
        parchment: {
          frame: {
            texture: makeFrameTexture(),
            insets: { left: 8, top: 8, right: 8, bottom: 8 },
          },
        },
      },
    };
    const bundle = createMixedDialogue(theme, {
      worldLayer: "bubble-world",
    });

    const host: Entity = this.spawn("dialogue-host");
    const probe = host.add(new DialogueProbe());
    const controller = host.add(new DialogueController(bundle));

    host.on(DialogueLineEvent, (e) => probe.onLine(e.text));
    host.on(DialogueChoiceShownEvent, (e) => probe.onChoiceShown(e.options));
    host.on(DialogueSelectionChangedEvent, (e) => probe.onSelectionChanged(e.index));
    host.on(DialogueChoiceMadeEvent, (e) => probe.onChoiceMade(e.text));
    host.on(DialogueEndedEvent, () => probe.onEnded());

    controller.play(SCRIPT);

    // Expose the controller so the spec can drive it deterministically. `advance`
    // and `choose` are part of the controller's public host API; assertions read
    // the Inspector-visible DialogueProbe, not the controller directly.
    (window as unknown as { __dialogue__: DialogueController }).__dialogue__ =
      controller;
    // Extra scripts the spec can `play()` to exercise overflow + textured chrome
    // without disturbing the default conversation the other specs drive.
    (window as unknown as { __scripts__: Record<string, DialogueScript> }).__scripts__ = {
      hub: HUB_SCRIPT,
      textured: TEXTURED_SCRIPT,
    };
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
