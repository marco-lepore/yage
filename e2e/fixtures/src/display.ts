import { Engine, InspectorKey, InspectorPlugin, Scene } from "@yagejs/core";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  HostDisplayKey,
  RendererPlugin,
  TestHostDisplay,
} from "@yagejs/renderer";
// The Recommended template's own button, driven here exactly as a scaffolded
// game drives it.
import { setupFullscreenButton } from "../../../packages/create-yage/templates/recommended/src/fullscreen.js";

/** What the page reports about the first engine's display. */
interface DisplayReading {
  isFullscreen: boolean;
  fullscreenSupport: string;
  orientation: string | null;
  orientationLockSupport: string;
  resolution: number;
  canvasSize: { width: number; height: number };
  backingWidth: number;
  buttonVisible: boolean;
  buttonLabel: string;
}

/** What the page reports about the second engine, which runs a fake display. */
interface SecondReading {
  isFullscreen: boolean;
  fullscreenSupport: string;
  orientation: string | null;
  calls: string[];
}

class DisplayScene extends Scene {
  readonly name = "display-scene";

  onEnter(): void {
    this.spawn("display-marker");
  }
}

const gameElement = document.getElementById("game")!;
const buttonElement = document.getElementById("fullscreen")!;
const otherElement = document.getElementById("other")!;

// Count what the page is asked for, so a test can tell "resolved without
// asking" from "asked and resolved".
const counters = { request: 0, exit: 0, error: 0 };
const pageRequest = Element.prototype.requestFullscreen;
Element.prototype.requestFullscreen = function (
  this: Element,
  options?: FullscreenOptions,
): Promise<void> {
  counters.request += 1;
  return pageRequest.call(this, options);
};
const pageExit = document.exitFullscreen.bind(document);
document.exitFullscreen = (): Promise<void> => {
  counters.exit += 1;
  return pageExit();
};
document.addEventListener("fullscreenerror", () => {
  counters.error += 1;
});

/** Every display event and request outcome, in the order they happened. */
const log: string[] = [];

// `?resolution=1` fixes the canvas density, the way a game that sets
// `resolution` in its renderer config does.
const fixed = new URLSearchParams(location.search).get("resolution");

const engine = new Engine({ debug: true });
engine.use(new InspectorPlugin());
const renderer = new RendererPlugin({
  width: 400,
  height: 300,
  container: gameElement,
  ...(fixed === null ? {} : { resolution: Number(fixed) }),
});
engine.use(renderer);
engine.use(new InputPlugin({ actions: {} }));
engine.events.on("screen:fullscreen", ({ active }) => {
  log.push(`fullscreen:${String(active)}`);
});
engine.events.on("screen:orientation", ({ type }) => {
  log.push(`orientation:${type}`);
});
await engine.start();
setupFullscreenButton(engine, renderer);
await engine.scenes.push(new DisplayScene());

// A second engine with its own display, to show that one engine's host does
// not reach the other and that the page is left alone.
const fake = new TestHostDisplay();
let second: Engine | undefined = new Engine();
const secondRenderer = new RendererPlugin({ width: 200, height: 150 });
second.use(secondRenderer);
second.context.register(HostDisplayKey, fake);
second.events.on("screen:fullscreen", ({ active }) => {
  log.push(`second-fullscreen:${String(active)}`);
});
await second.start();

/** Run `action` and record how its promise settled. */
async function settle(
  label: string,
  action: Promise<unknown>,
): Promise<string> {
  try {
    const value = await action;
    log.push(`resolved:${label}`);
    return typeof value === "string" ? value : "resolved";
  } catch (error) {
    log.push(`rejected:${label}`);
    return `rejected:${(error as Error).message}`;
  }
}

engine.context.resolve(InspectorKey).addExtension("display", {
  state(): DisplayReading {
    return {
      isFullscreen: renderer.isFullscreen,
      fullscreenSupport: renderer.fullscreenSupport,
      orientation: renderer.orientation,
      orientationLockSupport: renderer.orientationLockSupport,
      resolution: renderer.application.renderer.resolution,
      canvasSize: renderer.canvasSize,
      backingWidth: renderer.canvas.width,
      buttonVisible: !buttonElement.hidden,
      buttonLabel: buttonElement.textContent ?? "",
    };
  },
  log(): string[] {
    return [...log];
  },
  clearLog(): void {
    log.length = 0;
  },
  counters(): { request: number; exit: number; error: number } {
    return { ...counters };
  },
  request(): Promise<string> {
    return settle("request", renderer.requestFullscreen());
  },
  exit(): Promise<string> {
    return settle("exit", renderer.exitFullscreen());
  },
  async requestTwice(): Promise<string[]> {
    return Promise.all([
      settle("request-a", renderer.requestFullscreen()),
      settle("request-b", renderer.requestFullscreen()),
    ]);
  },
  async requestThenExit(): Promise<string[]> {
    return Promise.all([
      settle("request", renderer.requestFullscreen()),
      settle("exit", renderer.exitFullscreen()),
    ]);
  },
  lock(value: string): Promise<string> {
    return settle(
      "lock",
      renderer
        .lockOrientation(value as "landscape")
        .then((result) => result ?? "null"),
    );
  },
  fullscreenOther(): Promise<string> {
    return settle("other", otherElement.requestFullscreen());
  },
  otherIsFullscreen(): boolean {
    return document.fullscreenElement === otherElement;
  },
  canvasRect(): { x: number; y: number; width: number; height: number } {
    const rect = renderer.canvas.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  },
  buttonRect(): { x: number; y: number; width: number; height: number } {
    const rect = buttonElement.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  },
  canvasToVirtual(x: number, y: number): { x: number; y: number } {
    const point = renderer.canvasToVirtual(x, y);
    return { x: point.x, y: point.y };
  },
  pointer(): { x: number; y: number } | null {
    const point = engine.context.resolve(InputManagerKey).getPointerPosition();
    return point === null ? null : { x: point.x, y: point.y };
  },
  secondState(): SecondReading | null {
    if (second === undefined) return null;
    return {
      isFullscreen: secondRenderer.isFullscreen,
      fullscreenSupport: secondRenderer.fullscreenSupport,
      orientation: secondRenderer.orientation,
      calls: [...fake.calls],
    };
  },
  secondSet(state: { fullscreen?: boolean; orientation?: string }): void {
    fake.set(state as { fullscreen?: boolean });
  },
  secondRequest(): Promise<string> {
    return settle("second-request", secondRenderer.requestFullscreen());
  },
  destroySecond(): void {
    second?.destroy();
    second = undefined;
  },
});
