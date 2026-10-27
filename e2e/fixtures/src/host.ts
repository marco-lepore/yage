import {
  Engine,
  InspectorKey,
  InspectorPlugin,
  Scene,
  TestHostPlugin,
} from "@yagejs/core";

/**
 * Two engines on one page with no renderer: the first reports the browser
 * host, the second runs a host adapter. A version field the host leaves out
 * reads as `null`, because a key whose value is `undefined` does not cross the
 * page boundary intact.
 */
interface HostReading {
  runtime: string;
  os: string;
  appVersion: string | null;
  appBuild: string | null;
  runtimeVersion: string | null;
  frame: number;
}

class HostScene extends Scene {
  readonly name = "host-scene";

  onEnter(): void {
    this.spawn("host-marker");
  }
}

function read(engine: Engine): HostReading {
  const info = engine.host.info;
  return {
    runtime: info.runtime,
    os: info.os,
    appVersion: info.appVersion ?? null,
    appBuild: info.appBuild ?? null,
    runtimeVersion: info.runtimeVersion ?? null,
    frame: engine.loop.frameCount,
  };
}

const engine = new Engine({ debug: true });
engine.use(new InspectorPlugin());
await engine.start();
await engine.scenes.push(new HostScene());

// Only the first engine publishes `window.__yage__`, so destroying the second
// leaves the page's driver surface in place.
let second: Engine | undefined = new Engine();
second.use(new TestHostPlugin({ os: "android" }));
await second.start();

engine.context.resolve(InspectorKey).addExtension("host", {
  first(): HostReading {
    return read(engine);
  },
  second(): HostReading | null {
    return second === undefined ? null : read(second);
  },
  destroySecond(): void {
    second?.destroy();
    second = undefined;
  },
  userAgent(): string {
    return navigator.userAgent;
  },
});
