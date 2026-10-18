import { Component, InspectorKey, InspectorPlugin } from "@yagejs/core";
import type {
  CallbackErrorRecord,
  Engine,
  HostSnapshot,
  Plugin,
} from "@yagejs/core";
import { RendererKey } from "@yagejs/renderer";
import type { BaselineScene, CaseName } from "./cases.js";
import type { CaseReading } from "./probe.js";
import type { BaselineTarget } from "./boot.js";

/** The prefix every reported line carries. */
export const BASELINE_REPORT_PREFIX = "[yage-baseline]";

/**
 * The longest line that is reported whole. A host that forwards the page's
 * console output to a native log cuts a longer one, which would leave a
 * reader parsing half a line.
 */
const MAX_LINE_LENGTH = 4000;

/** Everything the page reports about itself, in one object. */
export interface BaselineReading {
  target: BaselineTarget;
  profile: "test";
  /** Random per page load; a change means the page restarted. */
  bootId: string;
  cases: CaseName[];
  /** The cases that have reached their own settled state. */
  settledCases: CaseName[];
  /** Whether every mounted case has settled. */
  settled: boolean;
  readings: Partial<Record<CaseName, CaseReading>>;
  host: HostSnapshot;
  errors: { callbackErrors: CallbackErrorRecord[] };
  /** Every `graphics:context` payload the page has seen, oldest first. */
  graphicsContext: boolean[];
  userAgent: string;
}

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

/** One point's colour, as red, green, blue and alpha from 0 to 255. */
export type BaselinePixel = [number, number, number, number];

/** What a driver can ask the page for. */
export interface BaselineExtension {
  read(): BaselineReading;
  /** Viewport CSS position of a virtual point, for real input from a driver. */
  pointFor(x: number, y: number): { x: number; y: number };
  /** The colour drawn at each of {@link BASELINE_PIXEL_POINTS}. */
  pixels(): Record<string, BaselinePixel>;
  /**
   * Take the graphics context away and wait for the page to get one back.
   * Only a WebGL context can be taken away from the page itself.
   */
  loseContext(): Promise<void>;
}

/** The plugins only a test build installs. */
export function testProfilePlugins(): Plugin[] {
  return [new InspectorPlugin()];
}

/**
 * Publish the page's readings: an Inspector extension a driver calls, and one
 * console line per event for a host that offers nothing but its log.
 */
export function installTestProfile(
  engine: Engine,
  scene: BaselineScene,
  target: BaselineTarget,
): void {
  const inspector = engine.context.resolve(InspectorKey);
  const bootId = crypto.randomUUID();
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
      userAgent: navigator.userAgent,
    };
  };

  const extension: BaselineExtension = {
    read,
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

  scene.spawn("baseline:reporter").add(new BaselineReporter(read, bootId));
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
    const line = `${BASELINE_REPORT_PREFIX} ${JSON.stringify({
      kind,
      bootId: this.bootId,
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
}
