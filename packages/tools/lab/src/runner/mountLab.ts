import type {
  AssetHandle,
  CallbackErrorRecord,
  Engine,
  Scene,
} from "@yagejs/core";
import { DebugPlugin } from "@yagejs/debug";
import type { LayerDef } from "@yagejs/renderer";
import {
  coerceControlValue,
  controlDefaults,
  type ControlValue,
} from "../grammar/controls.js";
import {
  DEFAULT_HARNESS_HEIGHT,
  DEFAULT_HARNESS_WIDTH,
  type HarnessDef,
} from "../grammar/harness.js";
import type { AnyScenario } from "../grammar/scenario.js";
import { LabClock } from "./LabClock.js";
import {
  CLOCK_ERROR_KIND,
  collectErrors,
  LINK_ERROR_KIND,
  LOOP_STOPPED_ERROR,
  REBUILD_ERROR_KIND,
  type LabError,
} from "./labErrors.js";
import { LabPanel } from "./LabPanel.js";
import { controlsFromUrl, readLabUrl, writeLabUrl } from "./labUrl.js";
import { RebuildQueue } from "./RebuildQueue.js";
import {
  type DriveResult,
  type ErasedDriveContext,
  runDrive,
} from "./runDrive.js";
import { ScenarioScene } from "./ScenarioScene.js";
import {
  buildRegistry,
  type RegistryProblem,
  type ScenarioEntry,
} from "./ScenarioRegistry.js";

/** The property `mount` writes its API to, for out-of-page drivers. */
export const LAB_GLOBAL = "__yageLab__";

/** `Engine.use` rejects a second plugin under a name already registered. */
const DEBUG_PLUGIN_NAME = "debug";

/** How often the readout and the errors section are re-read. */
const POLL_MS = 100;

/**
 * A slider drag changes state on every input event, and browsers rate-limit
 * history writes, so the URL trails the panel by this much.
 */
const URL_WRITE_MS = 250;

export interface MountOptions {
  harness: HarnessDef;
  /** The module map from `import.meta.glob("<pattern>", { eager: true })`. */
  modules: Record<string, unknown>;
  /** The glob root. Scenario ids are derived relative to it. */
  root?: string | undefined;
  /** Where the lab renders. Defaults to `document.body`. */
  host?: HTMLElement | undefined;
}

export interface LabApi {
  readonly engine: Engine;
  readonly scenarios: readonly ScenarioEntry[];
  /** Modules that were skipped, with the reason. */
  readonly problems: readonly RegistryProblem[];
  /** Play, pause, step and speed. Owns the frozen engine clock. */
  readonly clock: LabClock;
  current(): ScenarioEntry | undefined;
  controls(): Readonly<Record<string, ControlValue>>;
  scene(): Scene | undefined;
  /** Switches scenario and resets its controls to their declared values. */
  show(id: string): Promise<void>;
  /** Sets one control and rebuilds the scene. */
  setControl(name: string, value: ControlValue): Promise<void>;
  /**
   * Rebuilds the scene and runs the current scenario's `drive`, with the clock
   * control stopped for the duration. An assertion that fails is a result, not
   * a rejection; rejects when there is no scenario or it declares no `drive`.
   */
  run(): Promise<DriveResult>;
}

/**
 * `ScenarioDef<C>` types its callbacks against the scenario's own control
 * schema, which the registry erases. The runner only ever holds a plain value
 * record, so every call into a scenario goes through this one cast.
 */
interface ErasedScenario {
  scene?: (values: Record<string, ControlValue>) => Scene;
  setup?: (scene: Scene, values: Record<string, ControlValue>) => void;
  onMounted?: (scene: Scene, values: Record<string, ControlValue>) => void;
  drive?: (ctx: ErasedDriveContext) => Promise<void>;
  layers?: readonly LayerDef[] | undefined;
  preload?: readonly AssetHandle<unknown>[] | undefined;
}

function erase(def: AnyScenario): ErasedScenario {
  return def as unknown as ErasedScenario;
}

function buildScene(
  entry: ScenarioEntry,
  values: Record<string, ControlValue>,
): Scene {
  const def = erase(entry.scenario);
  if (def.scene) return def.scene(values);
  const setup = def.setup;
  if (!setup) {
    throw new Error(
      `Scenario "${entry.id}" declares neither scene nor setup — the registry should have skipped it.`,
    );
  }
  return new ScenarioScene(
    entry.id,
    (scene) => setup(scene, values),
    def.layers,
    def.preload,
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `detail` counts: it is the line naming the scene and entity that failed. */
function sameErrors(a: readonly LabError[], b: readonly LabError[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (error, index) =>
        error.kind === b[index]?.kind &&
        error.message === b[index]?.message &&
        error.detail === b[index]?.detail,
    )
  );
}

/**
 * Boots one engine from the harness and browses the scenarios in `modules`.
 *
 * Resolves once the first scenario is on screen. The returned API is also
 * written to `globalThis.__yageLab__` before the first mount, so a scenario
 * whose `setup` throws still leaves something to diagnose it with.
 */
export async function mount(opts: MountOptions): Promise<LabApi> {
  const { harness } = opts;
  const registry = buildRegistry(opts.modules, { root: opts.root });

  const panel = new LabPanel(opts.host ?? document.body, {
    width: harness.width ?? DEFAULT_HARNESS_WIDTH,
    height: harness.height ?? DEFAULT_HARNESS_HEIGHT,
    scenarios: registry.scenarios,
    problems: registry.problems,
    callbacks: {
      onSelect: (id) => void settle(show(id)),
      onControlChange: (name, value) => void settle(setControl(name, value)),
      onPlayToggle: () => {
        if (clock.isRunning) clock.pause();
        else clock.play();
        refresh();
      },
      onStep: (frames) => void settleStep(clock.step(frames)),
      onSpeedChange: (speed) => {
        clock.setSpeed(speed);
        refresh();
      },
      onRun: () => void settleRun(run()),
    },
  });

  const engine = harness.engine();
  const plugins = harness.plugins({ container: panel.container });
  // The clock is the panel's main control and `Inspector.time` throws without
  // DebugPlugin, so a harness that leaves it out still gets one.
  if (!plugins.some((plugin) => plugin.name === DEBUG_PLUGIN_NAME)) {
    plugins.push(new DebugPlugin());
  }
  for (const plugin of plugins) engine.use(plugin);

  const queue = new RebuildQueue();
  let entry: ScenarioEntry | undefined;
  let values: Record<string, ControlValue> = {};
  let scene: Scene | undefined;
  /** The two the lab raises itself. A rebuild clears both; a step clears its own. */
  let rebuildError: LabError | null = null;
  let stepError: LabError | null = null;
  /** The last error the engine had recorded when the mounted scene was built. */
  let errorMark: CallbackErrorRecord | null = null;
  let shown: readonly LabError[] = [];
  let writtenClockState = "";
  /** Until the engine has started, a loop that is not running is just boot. */
  let started = false;
  /** A run owns the clock and the scene until it finishes. */
  let driving = false;

  const clock = new LabClock(engine.inspector.time, {
    onError: (error: unknown) => {
      console.error("[yage-lab]", error);
      refresh();
    },
  });

  /**
   * The clock's frame count and the engine's error log have no change event to
   * subscribe to, so the panel re-reads both on a timer.
   *
   * The clock's play state reaches the URL from here rather than from the
   * buttons, so a caller that drives `LabApi.clock` itself is recorded too.
   */
  function refresh(): void {
    panel.setClock({
      running: clock.isRunning,
      speed: clock.speed,
      frame: clock.frame,
    });
    const clockState = `${clock.isRunning}@${clock.speed}`;
    if (clockState !== writtenClockState) {
      writtenClockState = clockState;
      scheduleUrlWrite();
    }
    const stopped = started && !engine.loop.isRunning;
    const errors = collectErrors(
      [rebuildError, stepError, stopped ? LOOP_STOPPED_ERROR : null].filter(
        (error) => error !== null,
      ),
      engine.inspector.getErrors().callbackErrors,
      errorMark,
    );
    if (sameErrors(errors, shown)) return;
    shown = errors;
    panel.showErrors(errors);
  }

  /**
   * The panel's calls are fire-and-forget, so a failure surfaces here or
   * nowhere. A scenario's `setup` is the game developer's own code and is the
   * thing most likely to throw.
   */
  function settle(work: Promise<void>): Promise<void> {
    return work.then(
      () => {
        refresh();
      },
      (error: unknown) => {
        console.error("[yage-lab]", error);
        rebuildError = {
          kind: REBUILD_ERROR_KIND,
          message: describeError(error),
        };
        refresh();
      },
    );
  }

  /**
   * The Run button is fire-and-forget too. `run` has already written a failure
   * to the panel, so only the console is left to tell.
   */
  function settleRun(work: Promise<DriveResult>): Promise<void> {
    return work.then(
      () => {
        refresh();
      },
      (error: unknown) => {
        console.error("[yage-lab]", error);
        refresh();
      },
    );
  }

  /** Tracked apart from a rebuild's, so one failing does not clear the other. */
  function settleStep(work: Promise<void>): Promise<void> {
    return work.then(
      () => {
        stepError = null;
        refresh();
      },
      (error: unknown) => {
        console.error("[yage-lab]", error);
        stepError = { kind: CLOCK_ERROR_KIND, message: describeError(error) };
        refresh();
      },
    );
  }

  /**
   * Reads the current entry and values rather than taking them as arguments,
   * so a rebuild dropped by the queue costs nothing: whichever call reaches the
   * queue's slot builds the newest state.
   */
  async function rebuild(): Promise<void> {
    if (!entry) return;
    const recorded = engine.inspector.getErrors().callbackErrors;
    errorMark = recorded[recorded.length - 1] ?? null;
    // Cleared here rather than in `settle`, so a rebuild reached through
    // `LabApi` clears them too. `settle` still records a rebuild that fails.
    rebuildError = null;
    stepError = null;
    const next = buildScene(entry, values);
    // Asked of the engine rather than tracked here: `push` preloads before it
    // stacks the scene, so a scenario whose assets fail to load leaves nothing
    // on the stack and the next attempt still has to push.
    if (engine.scenes.active) await engine.scenes.replace(next);
    else await engine.scenes.push(next);
    scene = next;
    erase(entry.scenario).onMounted?.(next, values);
  }

  /**
   * A run drives one scene with one set of values, so replacing either while
   * it is in flight would make its assertions read something else. The panel
   * disables the widgets that reach here; this is the same rule for a caller
   * holding `LabApi`.
   */
  function requireIdle(): void {
    if (driving) {
      throw new Error("A run is in flight. Wait for it to finish.");
    }
  }

  // Both are `async` so a bad argument rejects rather than throwing into
  // whatever called them — for the panel, that is a DOM event handler.
  /**
   * `overrides` are the raw values a URL carried. Anything the schema does not
   * accept keeps the value the control declares.
   */
  async function show(
    id: string,
    overrides?: Readonly<Record<string, string>>,
  ): Promise<void> {
    requireIdle();
    const found = registry.find(id);
    if (!found) throw new Error(`No scenario with id "${id}".`);
    entry = found;
    values = {
      ...controlDefaults(found.scenario.controls),
      ...controlsFromUrl(found.scenario.controls, overrides ?? {}),
    };
    panel.setCurrent(found, values);
    scheduleUrlWrite();
    await queue.schedule(rebuild);
  }

  async function setControl(name: string, value: ControlValue): Promise<void> {
    requireIdle();
    const def = entry?.scenario.controls?.[name];
    if (!def) {
      throw new Error(
        `Scenario "${entry?.id ?? "(none)"}" has no control named "${name}".`,
      );
    }
    values = { ...values, [name]: coerceControlValue(def, value) };
    panel.syncValues(values);
    // The last run described the scene these values just replaced.
    panel.setRun(undefined);
    scheduleUrlWrite();
    await queue.schedule(rebuild);
  }

  /**
   * A run and the clock control are two writers on one clock, so the clock is
   * stopped for the duration and its play state restored afterwards. The
   * rebuild comes first: a previous run left the scene wherever it drove it to.
   */
  async function run(): Promise<DriveResult> {
    const current = entry;
    if (!current) throw new Error("No scenario is mounted.");
    const drive = erase(current.scenario).drive;
    if (!drive)
      throw new Error(`Scenario "${current.id}" declares no drive().`);
    if (driving) throw new Error("A run is already in flight.");

    driving = true;
    panel.setRun({ state: "running" });
    try {
      const result = await clock.whileStopped(async () => {
        await queue.schedule(rebuild);
        if (!scene) throw new Error("No scene is mounted.");
        return runDrive(engine, scene, values, drive);
      });
      panel.setRun(
        result.ok
          ? {
              state: "pass",
              framesUsed: result.framesUsed,
              durationMs: result.durationMs,
            }
          : { state: "fail", message: result.error },
      );
      return result;
    } catch (error) {
      // `runDrive` reports a failed run rather than throwing, so this is the
      // rebuild or the clock — but it is still the run that did not happen.
      panel.setRun({ state: "fail", message: describeError(error) });
      throw error;
    } finally {
      driving = false;
    }
  }

  let urlTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleUrlWrite(): void {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(writeUrl, URL_WRITE_MS);
  }

  /**
   * `replaceState` rather than `pushState`: every control change would
   * otherwise land in the session history and a slider drag would fill it.
   */
  function writeUrl(): void {
    if (!entry) return;
    const search = writeLabUrl(location.search, {
      scenario: entry.id,
      controls: values,
      schema: entry.scenario.controls,
      speed: clock.speed,
      paused: !clock.isRunning,
    });
    history.replaceState(
      null,
      "",
      `${location.pathname}${search}${location.hash}`,
    );
  }

  const api: LabApi = {
    engine,
    scenarios: registry.scenarios,
    problems: registry.problems,
    clock,
    current: () => entry,
    controls: () => values,
    scene: () => scene,
    show: (id) => show(id),
    setControl,
    run,
  };
  (globalThis as Record<string, unknown>)[LAB_GLOBAL] = api;

  for (const problem of registry.problems) {
    console.warn(`[yage-lab] skipped ${problem.path}: ${problem.message}`);
  }

  await engine.start();
  started = true;
  // Before the first scenario is built: `engine.start()` starts the game loop,
  // and a clock nobody has frozen keeps simulating whatever is on the stack
  // while the panel reports the frame count it has issued itself.
  clock.freeze();

  const url = readLabUrl(location.search);
  const requested =
    url.scenario === undefined ? undefined : registry.find(url.scenario);
  const first = requested ?? registry.scenarios[0];
  if (first) {
    // The control values belong to the scenario the link named. Applying them
    // to a substitute would set a same-named control to a foreign value.
    await settle(show(first.id, requested ? url.controls : undefined));
  }
  // A link outlives the file it names, and 250ms later this page rewrites the
  // query string, so the id that missed is gone unless it is reported. Left to
  // whatever the rebuild reported, which is the worse news of the two.
  if (url.scenario !== undefined && !requested && rebuildError === null) {
    rebuildError = {
      kind: LINK_ERROR_KIND,
      message: `No scenario with id "${url.scenario}". Showing ${first?.title ?? "nothing"} instead.`,
    };
  }

  if (url.speed !== undefined) clock.setSpeed(url.speed);
  if (url.paused !== true) clock.play();
  refresh();
  setInterval(refresh, POLL_MS);

  return api;
}
