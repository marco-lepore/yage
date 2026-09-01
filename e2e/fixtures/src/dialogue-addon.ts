/**
 * Deterministic e2e fixture for @yagejs-addons/dialogue.
 *
 * Boots a tiny scene with `createMixedDialogue(defaultDialogueTheme())` (zero assets),
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
import { Assets, Texture } from "pixi.js";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import {
  DialogueController,
  DialogueLineEvent,
  DialogueChoiceShownEvent,
  DialogueChoiceMadeEvent,
  DialogueSelectionChangedEvent,
  DialogueRevealMarkerEvent,
  DialogueEndedEvent,
  type DialogueScript,
} from "@yagejs-addons/dialogue";
import {
  defaultDialogueTheme,
  createMixedDialogue,
  DialogueActor,
  InBoxAvatarPresenter,
  DIALOGUE_LAYERS,
  DIALOGUE_LAYER_AVATAR,
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

/** The in-box avatar's `meta.portrait` texture key. Preloaded into the Pixi
 *  cache in `onEnter` (after `RendererPlugin` initialises `Assets`) so the
 *  avatar resolves it synchronously, the way a host preloads portrait art. */
const PORTRAIT_KEY = "e2e/portrait";

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
    out: {
      id: "out",
      steps: [{ kind: "say", text: "Through it." }, { kind: "end" }],
    },
  },
};

/** Per-line `meta.position` moves the box frame. The probe reads the nameplate
 *  Y, which tracks the frame top, to prove top < center < bottom. */
const POSITION_SCRIPT: DialogueScript = {
  id: "position",
  start: "p",
  speakers: { narrator: { id: "narrator", name: "Narrator", color: 0xffd866 } },
  nodes: {
    p: {
      id: "p",
      steps: [
        {
          kind: "say",
          speaker: "narrator",
          text: "At the bottom.",
          meta: { position: "bottom" },
        },
        {
          kind: "say",
          speaker: "narrator",
          text: "At the top now.",
          meta: { position: "top" },
        },
        {
          kind: "say",
          speaker: "narrator",
          text: "In the centre.",
          meta: { position: "center" },
        },
        { kind: "end" },
      ],
    },
  },
};

/** A line-driven in-box avatar: `meta.portrait` shows the portrait and the body
 *  text reflows around its reserved column; a line without it reclaims the full
 *  width. The probe reads the body-text X to prove the reflow. */
const AVATAR_SCRIPT: DialogueScript = {
  id: "avatar",
  start: "av",
  speakers: { narrator: { id: "narrator", name: "Narrator", color: 0xffd866 } },
  nodes: {
    av: {
      id: "av",
      steps: [
        {
          kind: "say",
          speaker: "narrator",
          text: "No portrait yet, full width.",
        },
        {
          kind: "say",
          speaker: "narrator",
          text: "Now a portrait reflows the text.",
          meta: { portrait: PORTRAIT_KEY, side: "left" },
        },
        { kind: "end" },
      ],
    },
  },
};

/** Inline reveal markers + per-grapheme ticks. The line carries a self-closing
 *  `[sfx=knock/]` marker; as it types, ticks fire per grapheme and the marker
 *  fires at its offset → `DialogueRevealMarkerEvent` (the probe records both). */
const MARKER_SCRIPT: DialogueScript = {
  id: "marker",
  start: "m",
  speakers: { narrator: { id: "narrator", name: "Narrator", color: 0xffd866 } },
  nodes: {
    m: {
      id: "m",
      steps: [
        { kind: "say", speaker: "narrator", text: "Knock[sfx=knock/] knock." },
        { kind: "end" },
      ],
    },
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
        {
          kind: "say",
          speaker: "narrator",
          text: "Parchment frame here.",
          meta: { chrome: "parchment" },
        },
        {
          kind: "say",
          speaker: "narrator",
          text: "No frame at all.",
          meta: { chrome: "none" },
        },
        {
          kind: "say",
          speaker: "narrator",
          text: "Back to the default frame.",
        },
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
  /** Name of the last inline reveal marker that fired (DialogueRevealMarkerEvent). */
  markerName = "";
  markerCount = 0;
  /** Count of per-grapheme typewriter ticks (controller onRevealTick callback). */
  tickCount = 0;

  onLine(text: string): void {
    this.lastLine = text;
    this.lineCount++;
  }
  onMarker(name: string): void {
    this.markerName = name;
    this.markerCount++;
  }
  onTick(): void {
    this.tickCount++;
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

  /** Nameplate Y tracks the box frame top and moves with meta.position. */
  get nameY(): number {
    return this.entityY("dlg-name");
  }

  /** Body-text X tracks the active text region after avatar reflow. */
  get textX(): number {
    return this.entityX("dlg-line");
  }

  get avatarPresent(): boolean {
    return this.scene.findEntity("dlg-inbox-avatar") !== undefined;
  }

  get boxVisible(): boolean {
    return this.frameVisible("dlg-frame");
  }

  get bubbleVisible(): boolean {
    return this.frameVisible("dlg-bubble");
  }

  get texturedVisible(): boolean {
    return this.frameVisible("dlg-frame-tex");
  }

  get bubbleTextured(): boolean {
    return this.frameChildren("dlg-bubble") > 0;
  }

  /** Whether the named chrome entity's Graphics is currently visible. */
  private frameVisible(name: string): boolean {
    return (
      this.scene.findEntity(name)?.tryGet(GraphicsComponent)?.graphics
        .visible ?? false
    );
  }

  /** The named entity's Transform Y (−1 when absent). */
  private entityY(name: string): number {
    return this.scene.findEntity(name)?.tryGet(Transform)?.position.y ?? -1;
  }

  /** The named entity's Transform X (−1 when absent). */
  private entityX(name: string): number {
    return this.scene.findEntity(name)?.tryGet(Transform)?.position.x ?? -1;
  }

  /** Child count of the named chrome entity's Graphics (a nine-slice sprite is
   *  parented here when the bubble body is textured). */
  private frameChildren(name: string): number {
    return (
      this.scene.findEntity(name)?.tryGet(GraphicsComponent)?.graphics.children
        .length ?? 0
    );
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
    // Preload the in-box avatar portrait into the Pixi cache now that the
    // renderer has initialised Assets, so `texture(PORTRAIT_KEY)` resolves
    // synchronously when a meta.portrait line spawns the avatar sprite.
    Assets.cache.set(PORTRAIT_KEY, makeFrameTexture());

    const cam = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
    });
    this.context.resolve(InputManagerKey).setCamera(cam);

    const guide = this.spawn("guide-entity");
    guide.add(
      new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2 - 40) }),
    );
    guide.add(new Guide());

    // Default: a NAMED "parchment" style only (no "default"), so the main
    // script's box lines keep the drawn Graphics frame and the existing specs
    // that read `boxVisible` still hold; the `meta.chrome` script opts in per
    // line. `?theme=textured` instead installs a fully-textured "default" style
    // (box + bubble nine-slice) for the bubble-textured spec.
    const insets = { left: 8, top: 8, right: 8, bottom: 8 };
    const fullyTextured =
      new URLSearchParams(location.search).get("theme") === "textured";
    const theme = fullyTextured
      ? {
          ...defaultDialogueTheme(),
          textured: {
            default: {
              frame: { texture: makeFrameTexture(), insets },
              bubble: { texture: makeFrameTexture(), insets },
            },
          },
        }
      : {
          ...defaultDialogueTheme(),
          textured: {
            parchment: { frame: { texture: makeFrameTexture(), insets } },
          },
        };
    const bundle = createMixedDialogue(theme, {
      worldLayer: "bubble-world",
      // A line-driven, reflowing in-box avatar wired to the box's layout owner —
      // inert unless a line carries meta.portrait.
      avatar: {
        box: (layout) =>
          new InBoxAvatarPresenter(layout, {
            layer: DIALOGUE_LAYER_AVATAR,
            width: 80,
          }),
      },
    });

    const host: Entity = this.spawn("dialogue-host");
    const probe = host.add(new DialogueProbe());
    // onRevealTick is a controller callback (NOT an entity event — it fires per
    // grapheme); the marker is an entity event the probe listens for below.
    const controller = host.add(
      new DialogueController({ ...bundle, onRevealTick: () => probe.onTick() }),
    );

    host.on(DialogueLineEvent, (e) => probe.onLine(e.text));
    host.on(DialogueChoiceShownEvent, (e) => probe.onChoiceShown(e.options));
    host.on(DialogueSelectionChangedEvent, (e) =>
      probe.onSelectionChanged(e.index),
    );
    host.on(DialogueChoiceMadeEvent, (e) => probe.onChoiceMade(e.text));
    host.on(DialogueRevealMarkerEvent, (e) => probe.onMarker(e.marker.name));
    host.on(DialogueEndedEvent, () => probe.onEnded());

    controller.play(SCRIPT);

    // Expose the controller so the spec can drive it deterministically. `advance`
    // and `choose` are part of the controller's public host API; assertions read
    // the Inspector-visible DialogueProbe, not the controller directly.
    (window as unknown as { __dialogue__: DialogueController }).__dialogue__ =
      controller;
    // Extra scripts the spec can `play()` to exercise overflow + textured chrome
    // without disturbing the default conversation the other specs drive.
    (
      window as unknown as { __scripts__: Record<string, DialogueScript> }
    ).__scripts__ = {
      hub: HUB_SCRIPT,
      textured: TEXTURED_SCRIPT,
      position: POSITION_SCRIPT,
      avatar: AVATAR_SCRIPT,
      marker: MARKER_SCRIPT,
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
