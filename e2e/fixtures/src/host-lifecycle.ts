import {
  Component,
  Engine,
  InspectorKey,
  InspectorPlugin,
  Scene,
  TestHostPlugin,
} from "@yagejs/core";
import { InputManagerKey, InputPlugin } from "@yagejs/input";

/**
 * Two engines on one page with no renderer. The first follows the page, pauses
 * its scenes while the host is inactive, and releases held input. The second
 * runs a host adapter, so a report to it must leave the first alone.
 */
class Ticker extends Component {
  updates = 0;

  update(): void {
    this.updates += 1;
  }
}

class PlayScene extends Scene {
  readonly name = "play-scene";
  readonly ticker = new Ticker();
  pauses = 0;
  resumes = 0;

  onEnter(): void {
    this.spawn("play-marker").add(this.ticker);
  }

  onPause(): void {
    this.pauses += 1;
  }

  onResume(): void {
    this.resumes += 1;
  }
}

class OverlayScene extends Scene {
  readonly name = "overlay-scene";
  pauses = 0;
  resumes = 0;

  onPause(): void {
    this.pauses += 1;
  }

  onResume(): void {
    this.resumes += 1;
  }
}

interface LifecycleReading {
  activity: string;
  visibility: string;
  focus: string;
  active: boolean;
  activeWhenUnfocused: boolean;
  paused: boolean;
  updates: number;
  pauses: number;
  resumes: number;
  frame: number;
  jumpHeld: boolean;
  stack: string[];
  overlayPauses: number;
  overlayResumes: number;
}

const engine = new Engine({ debug: true });
engine.use(new InspectorPlugin());
engine.use(new InputPlugin({ actions: { jump: ["Space"] } }));
await engine.start();
engine.scenes.autoPause = true;
const play = new PlayScene();
await engine.scenes.push(play);

let overlay: OverlayScene | undefined;

// Only the first engine publishes `window.__yage__`, so destroying the second
// leaves the page's driver surface in place.
let second: Engine | undefined = new Engine();
const fakeHost = new TestHostPlugin({ os: "android" });
second.use(fakeHost);
await second.start();
const secondPlay = new PlayScene();
second.scenes.autoPause = true;
await second.scenes.push(secondPlay);

function read(): LifecycleReading {
  const host = engine.context.resolve(InspectorKey).getHost();
  return {
    activity: host.lifecycle.activity,
    visibility: host.lifecycle.visibility,
    focus: host.lifecycle.focus,
    active: host.active,
    activeWhenUnfocused: host.activeWhenUnfocused,
    paused: play.isPaused,
    updates: play.ticker.updates,
    pauses: play.pauses,
    resumes: play.resumes,
    frame: engine.loop.frameCount,
    jumpHeld: engine.context.resolve(InputManagerKey).isPressed("jump"),
    stack: engine.scenes.all.map((scene) => scene.name),
    overlayPauses: overlay?.pauses ?? 0,
    overlayResumes: overlay?.resumes ?? 0,
  };
}

engine.context.resolve(InspectorKey).addExtension("lifecycle", {
  first: read,
  secondPaused(): boolean | null {
    return second === undefined ? null : secondPlay.isPaused;
  },
  setManualPause(paused: boolean): void {
    play.paused = paused;
  },
  async pushOverlay(): Promise<void> {
    overlay = new OverlayScene();
    await engine.scenes.push(overlay);
  },
  setActiveWhenUnfocused(value: boolean): void {
    engine.host.activeWhenUnfocused = value;
  },
  report(state: { activity?: string; visibility?: string; focus?: string }) {
    fakeHost.setLifecycle(state as Parameters<typeof fakeHost.setLifecycle>[0]);
  },
  destroySecond(): void {
    second?.destroy();
    second = undefined;
  },
});
