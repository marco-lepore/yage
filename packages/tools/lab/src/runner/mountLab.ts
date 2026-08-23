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
  captureLab,
  type CaptureView,
  type LabCaptureResult,
} from "./labCapture.js";
import { LAB_GLOBAL } from "./labGlobal.js";
import {
  CLOCK_ERROR_KIND,
  collectErrors,
  DRIVE_ERROR_KIND,
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
  type RunPace,
  runDrive,
} from "./runDrive.js";
import { ScenarioScene } from "./ScenarioScene.js";
import {
  buildRegistry,
  type RegistryProblem,
  type ScenarioEntry,
} from "./ScenarioRegistry.js";

export { LAB_GLOBAL };

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
  /**
   * Resolves once the first scenario has been mounted, or has failed to mount.
   * The API is published before the engine starts, so its presence alone does
   * not mean there is anything to drive yet. Rejects with whatever stopped the
   * engine from starting.
   */
  readonly ready: Promise<void>;
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
  run(opts?: {
    pace?: RunPace;
    captureView?: CaptureView;
  }): Promise<DriveResult>;
  /**
   * Runs `fn` with the same context a scenario's `drive` receives, against
   * the scene as it currently stands — a value a previous `drive` or `run`
   * left mutated is still mutated. Unlike `run()`, this does not rebuild the
   * scene first unless `opts.rebuild` is `true`, and the scenario does not
   * need to declare its own `drive`. The clock control is stopped for the
   * duration and its play state restored afterwards. A throw inside `fn`
   * (including a failed `expect`) resolves with `ok: false` rather than
   * rejecting. Rejects when no scenario is mounted, when a run or drive is
   * already in flight, when `opts.rebuild` is `true` and the rebuild itself
   * throws, when no scene is mounted at all (the boot rebuild failed), and
   * when the mounted scene does not match the current scenario and values
   * because a rebuild already queued for them threw.
   */
  drive<T = void>(
    fn: (ctx: ErasedDriveContext) => Promise<T> | T,
    opts?: { rebuild?: boolean; pace?: RunPace; captureView?: CaptureView },
  ): Promise<DriveResult<T>>;
  /** Captures the current scene for an out-of-page driver. */
  capture(view?: CaptureView): Promise<LabCaptureResult>;
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
      onRun: (pace) => void settleRun(run({ pace })),
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
  /**
   * The entry and values `scene` was built from. A rebuild that throws leaves
   * these behind while `entry`/`values` have already moved on, which is how a
   * drive tells a scene that matches the panel from one that does not.
   */
  let builtEntry: ScenarioEntry | undefined;
  let builtValues: Record<string, ControlValue> | undefined;
  /** The three the lab raises itself. A rebuild clears all of them; a step clears its own. */
  let rebuildError: LabError | null = null;
  let stepError: LabError | null = null;
  /**
   * An ad-hoc `drive()` failure. Distinct from `run()`'s, which the panel
   * shows next to the Run button instead: an ad-hoc drive does not
   * necessarily run the scenario's own declared `drive`.
   */
  let driveError: LabError | null = null;
  /** The last error the engine had recorded when the mounted scene was built. */
  let errorMark: CallbackErrorRecord | null = null;
  let shown: readonly LabError[] = [];
  let writtenClockState = "";
  /** Until the engine has started, a loop that is not running is just boot. */
  let started = false;
  /** A run or an ad-hoc drive owns the clock and the scene until it finishes. */
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
      [
        rebuildError,
        stepError,
        driveError,
        stopped ? LOOP_STOPPED_ERROR : null,
      ].filter((error) => error !== null),
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
    driveError = null;
    // Read once, before the mount is awaited. A fire-and-forget `setControl`
    // can land during that await and move `entry`/`values` on to what the
    // next rebuild will use, and everything below describes this one.
    const builtWith = entry;
    const builtFrom = values;
    const next = buildScene(builtWith, builtFrom);
    // Asked of the engine rather than tracked here: `push` preloads before it
    // stacks the scene, so a scenario whose assets fail to load leaves nothing
    // on the stack and the next attempt still has to push.
    if (engine.scenes.active) await engine.scenes.replace(next);
    else await engine.scenes.push(next);
    scene = next;
    builtEntry = builtWith;
    builtValues = builtFrom;
    erase(builtWith.scenario).onMounted?.(next, builtFrom);
  }

  /**
   * A run or a drive holds one scene with one set of values, so replacing
   * either while it is in flight would make its assertions read something
   * else. The panel disables the widgets that reach here for either one;
   * this is the same rule for a caller holding `LabApi` directly.
   */
  function requireIdle(): void {
    if (driving) {
      throw new Error("A run or drive is in flight. Wait for it to finish.");
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
   * What `run()` and `drive()` share: freezes the clock so a driven call is
   * the only thing issuing frames, holds `driving` (and the panel's busy
   * flag) so the other calls above reject for the duration, runs `prepare`
   * before `fn`, and always restores the clock's play state on the way out.
   */
  async function driveScene<T>(
    prepare: () => Promise<void>,
    fn: (ctx: ErasedDriveContext) => Promise<T> | T,
    opts?: { pace?: RunPace; captureView?: CaptureView },
  ): Promise<DriveResult<T>> {
    driving = true;
    panel.setBusy(true);
    try {
      return await clock.whileStopped(async () => {
        await prepare();
        if (!scene) throw new Error("No scene is mounted.");
        return runDrive(engine, scene, values, fn, opts);
      });
    } finally {
      driving = false;
      panel.setBusy(false);
    }
  }

  /**
   * A run and the clock control are two writers on one clock, so the clock is
   * stopped for the duration and its play state restored afterwards. The
   * rebuild comes first: a previous run left the scene wherever it drove it to.
   */
  async function run(opts?: {
    pace?: RunPace;
    captureView?: CaptureView;
  }): Promise<DriveResult> {
    const current = entry;
    if (!current) throw new Error("No scenario is mounted.");
    const scenarioDrive = erase(current.scenario).drive;
    if (!scenarioDrive)
      throw new Error(`Scenario "${current.id}" declares no drive().`);
    if (driving) throw new Error("A run or drive is already in flight.");

    panel.setRun({ state: "running" });
    try {
      const result = await driveScene(
        () => queue.schedule(rebuild),
        scenarioDrive,
        opts,
      );
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
    }
  }

  /**
   * Runs `fn` against the scene as it currently stands. Unlike `run()`, no
   * rebuild happens first unless `opts.rebuild` says so — an ad-hoc drive
   * exercises the scene where a previous drive or manual play left it,
   * rather than starting over. The scenario does not need its own `drive`.
   *
   * A failure inside `fn` is reported through the panel's errors area rather
   * than `setRun`, which stays reserved for the scenario's own declared
   * `drive` — an ad-hoc drive did not necessarily run it, and writing there
   * would read as a scenario run that did not happen.
   */
  async function drive<T = void>(
    fn: (ctx: ErasedDriveContext) => Promise<T> | T,
    opts?: { rebuild?: boolean; pace?: RunPace; captureView?: CaptureView },
  ): Promise<DriveResult<T>> {
    if (!entry) throw new Error("No scenario is mounted.");
    requireIdle();

    if (opts?.rebuild) {
      // The last run described the scene this rebuild is about to replace.
      panel.setRun(undefined);
    }

    // Set inside `prepare` below when the opt-in rebuild itself throws, so
    // the catch further down does not also relabel that failure as a drive
    // failure.
    let rebuildFailed = false;
    const prepare = opts?.rebuild
      ? async (): Promise<void> => {
          try {
            await queue.schedule(rebuild);
          } catch (error) {
            rebuildFailed = true;
            rebuildError = {
              kind: REBUILD_ERROR_KIND,
              message: describeError(error),
            };
            throw error;
          }
        }
      : // No rebuild was asked for, but a fire-and-forget `show`/`setControl`
        // (the panel's own scenario clicks and control widgets never await
        // their call) may have one queued or running already. Reading `scene`
        // before it lands would hand this drive a scene the queue is about to
        // replace.
        async (): Promise<void> => {
          await queue.idle;
          // `idle` resolves whether that rebuild succeeded or threw. One that
          // threw leaves the outgoing scene mounted under the incoming
          // scenario's values, and a drive against that pair would report a
          // pass for a state the panel never reached.
          if (scene && (builtEntry !== entry || builtValues !== values)) {
            throw new Error(
              "The mounted scene was not built from the current scenario and control values — the rebuild that would have matched them failed. Fix the scenario, or pass { rebuild: true }.",
            );
          }
        };

    try {
      const result = await driveScene(prepare, fn, opts);
      driveError = result.ok
        ? null
        : { kind: DRIVE_ERROR_KIND, message: result.error };
      refresh();
      return result;
    } catch (error) {
      if (!rebuildFailed) {
        driveError = { kind: DRIVE_ERROR_KIND, message: describeError(error) };
      }
      refresh();
      throw error;
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

  // Settled at the end of this function. The executor runs synchronously, so
  // both are assigned before anything can reach them.
  let markReady!: () => void;
  let failReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    failReady = reject;
  });
  // A caller that only wants the panel never looks at `ready`, and an
  // unobserved rejection would be reported as an unhandled one.
  void ready.catch(() => undefined);

  const api: LabApi = {
    engine,
    scenarios: registry.scenarios,
    problems: registry.problems,
    clock,
    ready,
    current: () => entry,
    controls: () => values,
    scene: () => scene,
    show: (id) => show(id),
    setControl,
    run,
    drive,
    capture: (view) => captureLab(engine, view),
  };
  (globalThis as Record<string, unknown>)[LAB_GLOBAL] = api;

  for (const problem of registry.problems) {
    console.warn(`[yage-lab] skipped ${problem.path}: ${problem.message}`);
  }

  // Everything below can throw, and the caller that took the API off the
  // global is waiting on `ready` rather than on this call. Without the reject
  // it would wait for a boot that already failed.
  try {
    await engine.start();
    started = true;
    // Before the first scenario is built: `engine.start()` starts the game
    // loop, and a clock nobody has frozen keeps simulating whatever is on the
    // stack while the panel reports the frame count it has issued itself.
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
  } catch (error) {
    failReady(error);
    throw error;
  }

  markReady();
  return api;
}
