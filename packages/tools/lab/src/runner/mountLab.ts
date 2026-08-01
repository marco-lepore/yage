import type { AssetHandle, Engine, Scene } from "@yagejs/core";
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
import { LabPanel } from "./LabPanel.js";
import { RebuildQueue } from "./RebuildQueue.js";
import { ScenarioScene } from "./ScenarioScene.js";
import {
  buildRegistry,
  type RegistryProblem,
  type ScenarioEntry,
} from "./ScenarioRegistry.js";

/** The property `mount` writes its API to, for out-of-page drivers. */
export const LAB_GLOBAL = "__yageLab__";

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
  current(): ScenarioEntry | undefined;
  controls(): Readonly<Record<string, ControlValue>>;
  scene(): Scene | undefined;
  /** Switches scenario and resets its controls to their declared values. */
  show(id: string): Promise<void>;
  /** Sets one control and rebuilds the scene. */
  setControl(name: string, value: ControlValue): Promise<void>;
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
    },
  });

  const engine = harness.engine();
  for (const plugin of harness.plugins({ container: panel.container })) {
    engine.use(plugin);
  }

  const queue = new RebuildQueue();
  let entry: ScenarioEntry | undefined;
  let values: Record<string, ControlValue> = {};
  let scene: Scene | undefined;

  /**
   * The panel's calls are fire-and-forget, so a failed rebuild surfaces here or
   * nowhere. A scenario's `setup` is the game developer's own code and is the
   * thing most likely to throw.
   */
  function settle(work: Promise<void>): Promise<void> {
    return work.then(
      () => {
        panel.showError(null);
      },
      (error: unknown) => {
        console.error("[yage-lab]", error);
        panel.showError(error instanceof Error ? error.message : String(error));
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
    const next = buildScene(entry, values);
    // Asked of the engine rather than tracked here: `push` preloads before it
    // stacks the scene, so a scenario whose assets fail to load leaves nothing
    // on the stack and the next attempt still has to push.
    if (engine.scenes.active) await engine.scenes.replace(next);
    else await engine.scenes.push(next);
    scene = next;
    erase(entry.scenario).onMounted?.(next, values);
  }

  // Both are `async` so a bad argument rejects rather than throwing into
  // whatever called them — for the panel, that is a DOM event handler.
  async function show(id: string): Promise<void> {
    const found = registry.find(id);
    if (!found) throw new Error(`No scenario with id "${id}".`);
    entry = found;
    values = controlDefaults(found.scenario.controls);
    panel.setCurrent(found, values);
    await queue.schedule(rebuild);
  }

  async function setControl(name: string, value: ControlValue): Promise<void> {
    const def = entry?.scenario.controls?.[name];
    if (!def) {
      throw new Error(
        `Scenario "${entry?.id ?? "(none)"}" has no control named "${name}".`,
      );
    }
    values = { ...values, [name]: coerceControlValue(def, value) };
    panel.syncValues(values);
    await queue.schedule(rebuild);
  }

  const api: LabApi = {
    engine,
    scenarios: registry.scenarios,
    problems: registry.problems,
    current: () => entry,
    controls: () => values,
    scene: () => scene,
    show,
    setControl,
  };
  (globalThis as Record<string, unknown>)[LAB_GLOBAL] = api;

  for (const problem of registry.problems) {
    console.warn(`[yage-lab] skipped ${problem.path}: ${problem.message}`);
  }

  await engine.start();

  const first = registry.scenarios[0];
  if (first) await settle(show(first.id));

  return api;
}
