import {
  Component,
  InspectorKey,
  InspectorPlugin,
  createStore,
} from "@yagejs/core";
import type { Engine, Plugin } from "@yagejs/core";
import { RendererKey } from "@yagejs/renderer";
import type { OrientationLock } from "@yagejs/renderer";
import { SaveServiceKey } from "@yagejs/save";
import type { BaselineScene, CaseName } from "./cases.js";
import type { CaseReading } from "./probe.js";
import { launchSearch } from "./boot.js";
import type {
  BaselineExtension,
  BaselinePixel,
  BaselineReading,
  BaselineTarget,
} from "./types.js";

/** The prefix every reported line carries. */
export const BASELINE_REPORT_PREFIX = "[yage-baseline]";

/**
 * The longest line that is reported whole. A host that forwards the page's
 * console output to a native log cuts a longer one, which would leave a
 * reader parsing half a line.
 */
const MAX_LINE_LENGTH = 4000;

/**
 * Named points of the drawing, in virtual pixels. A driver reads the colour
 * at each one before and after a change to see what the page still draws.
 */
export const BASELINE_PIXEL_POINTS: Readonly<
  Record<string, readonly [number, number]>
> = {
  sprite: [120, 180],
  mask: [240, 180],
  renderTarget: [480, 300],
  bakedTexture: [360, 300],
  followingTarget: [410, 300],
  effect: [560, 90],
  lamp: [480, 180],
  far: [40, 40],
};

/** The plugins only a test build installs. */
export function testProfilePlugins(): Plugin[] {
  return [new InspectorPlugin()];
}

/**
 * Publish the page's readings: an Inspector extension a driver calls, and one
 * console line per event for a host that offers nothing but its log.
 *
 * The extension is registered straight away, so a case whose setup throws
 * while the scene enters still leaves a driver a reading to pull. Call the
 * returned function once the scene is on the stack: the reporter it spawns
 * is an entity of that scene.
 */
export function installTestProfile(
  engine: Engine,
  scene: BaselineScene,
  target: BaselineTarget,
  lock?: OrientationLock,
): () => void {
  const inspector = engine.context.resolve(InspectorKey);
  const bootId = crypto.randomUUID();
  const stringEvaluation = allowsStringEvaluation();
  const graphicsContext: boolean[] = [];
  engine.events.on("graphics:context", ({ lost }) => {
    graphicsContext.push(lost);
  });

  const read = (): BaselineReading => {
    const readings: Partial<Record<CaseName, CaseReading>> = {};
    const settledCases: CaseName[] = [];
    for (const name of scene.cases) {
      const probe = scene.probes.get(name);
      if (probe === undefined) continue;
      readings[name] = probe.reading();
      if (probe.settled) settledCases.push(name);
    }
    return {
      target,
      profile: "test",
      bootId,
      cases: [...scene.cases],
      settledCases,
      settled: settledCases.length === scene.cases.length,
      readings,
      host: inspector.getHost(),
      errors: { callbackErrors: inspector.getErrors().callbackErrors },
      graphicsContext: [...graphicsContext],
      policy: { stringEvaluation },
      userAgent: navigator.userAgent,
    };
  };

  const extension: BaselineExtension = {
    read,
    async fullscreen(
      active: boolean,
    ): Promise<
      { outcome: "resolved" } | { outcome: "rejected"; message: string }
    > {
      const renderer = engine.context.resolve(RendererKey);
      try {
        await (active
          ? renderer.requestFullscreen()
          : renderer.exitFullscreen());
        return { outcome: "resolved" };
      } catch (error) {
        return { outcome: "rejected", message: (error as Error).message };
      }
    },
    pointFor(x: number, y: number): { x: number; y: number } {
      const renderer = engine.context.resolve(RendererKey);
      const point = renderer.virtualToCanvas(x, y);
      const rect = renderer.canvas.getBoundingClientRect();
      return { x: rect.left + point.x, y: rect.top + point.y };
    },
    pixels(): Record<string, BaselinePixel> {
      const renderer = engine.context.resolve(RendererKey);
      // Draw and copy in one task: the browser clears the drawing buffer
      // once it has composited the page.
      renderer.render();
      const canvas = renderer.canvas;
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext("2d");
      if (ctx === null) {
        throw new Error("Baseline: the page offers no 2d canvas context.");
      }
      ctx.drawImage(canvas, 0, 0);
      const scale = canvas.width / renderer.canvasSize.width;
      const read: Record<string, BaselinePixel> = {};
      for (const [name, [x, y]] of Object.entries(BASELINE_PIXEL_POINTS)) {
        const point = renderer.virtualToCanvas(x, y);
        const data = ctx.getImageData(
          Math.round(point.x * scale),
          Math.round(point.y * scale),
          1,
          1,
        ).data;
        read[name] = [data[0]!, data[1]!, data[2]!, data[3]!];
      }
      return read;
    },
    async loseContext(): Promise<void> {
      const renderer = engine.context.resolve(RendererKey);
      const backend = renderer.capabilities.backend;
      if (backend === "webgpu") {
        throw new Error(
          'Baseline: loseContext needs a WebGL context, got backend "webgpu".',
        );
      }
      const gl = (
        renderer.application.renderer as unknown as {
          gl: WebGL2RenderingContext;
        }
      ).gl;
      const control = gl.getExtension("WEBGL_lose_context");
      if (control === null) {
        throw new Error(
          "Baseline: this context cannot be taken away from the page.",
        );
      }
      const lost = waitForContext(engine, true);
      control.loseContext();
      await lost;
      const back = waitForContext(engine, false);
      control.restoreContext();
      await back;
      await nextFrame();
      await nextFrame();
    },
  };
  inspector.addExtension("baseline", extension);

  return () => {
    scene.spawn("baseline:reporter").add(new BaselineReporter(read, bootId));
    if (new URLSearchParams(launchSearch()).get("writeLoop") === "1") {
      void writeLoop(engine, bootId);
    }
    if (lock !== undefined) void reportOrientationLock(engine, bootId, lock);
  };
}

/**
 * Lock the screen through the renderer, report the orientation it settled
 * at and how long that took, then release it.
 */
async function reportOrientationLock(
  engine: Engine,
  bootId: string,
  lock: OrientationLock,
): Promise<void> {
  const renderer = engine.context.resolve(RendererKey);
  const started = performance.now();
  try {
    const result = await renderer.lockOrientation(lock);
    writeLine(bootId, "orientation", {
      requested: lock,
      result,
      ms: Math.round(performance.now() - started),
      error: null,
    });
  } catch (error) {
    writeLine(bootId, "orientation", {
      requested: lock,
      result: null,
      ms: Math.round(performance.now() - started),
      error: (error as Error).message,
    });
  }
  await renderer.unlockOrientation();
  writeLine(bootId, "orientation-unlocked", {});
}

/** The one counter the write loop keeps. */
const loop = createStore((state) => ({
  n: state.counter({ default: 0 }),
}));

/**
 * Write one document over and over, reporting each write the storage
 * acknowledged, so a driver that kills the process can check what a relaunch
 * reads back. Each write starts when the previous one resolved.
 */
async function writeLoop(engine: Engine, bootId: string): Promise<void> {
  const save = engine.context.resolve(SaveServiceKey);
  let found: number | null = null;
  let failure: string | null = null;
  try {
    await save.restore("loop", loop);
    found = loop.n.value() === 0 ? null : loop.n.value();
  } catch (error) {
    failure = (error as Error).message;
  }
  writeLine(bootId, "loop-start", { found, error: failure });
  if (failure !== null) return;
  for (;;) {
    loop.n.increment(1);
    await save.persist("loop", loop);
    writeLine(bootId, "write", { n: loop.n.value() });
  }
}

/** One reported line, in the shape every driver parses. */
function writeLine(
  bootId: string,
  kind: string,
  data: Record<string, unknown>,
): void {
  const line = `${BASELINE_REPORT_PREFIX} ${JSON.stringify({
    kind,
    bootId,
    at: performance.now(),
    ...data,
  })}`;
  if (line.length > MAX_LINE_LENGTH) {
    throw new Error(
      `Baseline reporter: the ${kind} line is ${line.length} characters, ` +
        `the limit is ${MAX_LINE_LENGTH}.`,
    );
  }
  console.info(line);
}

/** Whether the page lets a script turn a string into code. */
function allowsStringEvaluation(): boolean {
  try {
    return new Function("return true")() === true;
  } catch {
    return false;
  }
}

/** Resolve when the renderer reports the context lost or back. */
function waitForContext(engine: Engine, lost: boolean): Promise<void> {
  return new Promise((resolve) => {
    const off = engine.events.on("graphics:context", (payload) => {
      if (payload.lost !== lost) return;
      off();
      resolve();
    });
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * The `DEBUG` value the Capacitor app wrote on `window.Capacitor`, which
 * `capacitorSaveAdapter` reads when a game passes no profile. `null` on a page
 * outside a Capacitor app.
 */
function capacitorDebug(): unknown {
  const page = window as unknown as { Capacitor?: { DEBUG?: unknown } };
  return page.Capacitor?.DEBUG ?? null;
}

/** Writes one line per reported event. */
class BaselineReporter extends Component {
  private readonly reported = new Set<CaseName>();
  private settledReported = false;
  private reportedErrors = 0;

  constructor(
    private readonly read: () => BaselineReading,
    private readonly bootId: string,
  ) {
    super();
  }

  onAdd(): void {
    const reading = this.read();
    this.write("boot", {
      target: reading.target,
      cases: reading.cases,
      userAgent: reading.userAgent,
      host: reading.host,
      capacitorDebug: capacitorDebug(),
    });
    this.listenBus("host:active", (payload) => {
      this.write("host", { event: "host:active", payload });
    });
    this.listenBus("host:lifecycle", (payload) => {
      this.write("host", { event: "host:lifecycle", payload });
    });
  }

  update(): void {
    const reading = this.read();
    // A case reports once, as soon as it settles, so a reader sees the first
    // state the case reached rather than the latest.
    for (const name of reading.settledCases) {
      if (this.reported.has(name)) continue;
      const value = reading.readings[name];
      if (value === undefined) continue;
      this.reported.add(name);
      this.write("case", { case: name, reading: value });
    }
    if (reading.settled && !this.settledReported) {
      this.settledReported = true;
      this.write("settled", {});
    }
    const errors = reading.errors.callbackErrors;
    if (errors.length > this.reportedErrors) {
      const added = errors.slice(this.reportedErrors);
      this.reportedErrors = errors.length;
      this.write("error", { errors: added });
    }
  }

  private write(kind: string, data: Record<string, unknown>): void {
    writeLine(this.bootId, kind, data);
  }
}
