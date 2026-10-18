import { Scene } from "@yagejs/core";
import type { AssetHandle, ComponentClass, Entity } from "@yagejs/core";
import { CaseProbe } from "./probe.js";
import * as sprites from "./cases/sprites.js";
import * as textUi from "./cases/text-ui.js";
import * as masks from "./cases/masks.js";
import * as renderTargets from "./cases/render-targets.js";
import * as effects from "./cases/effects.js";
import * as lighting from "./cases/lighting.js";
import * as physics from "./cases/physics.js";
import * as workers from "./cases/workers.js";
import * as audio from "./cases/audio.js";
import * as input from "./cases/input.js";
import * as saves from "./cases/saves.js";
import * as lifecycle from "./cases/lifecycle.js";
import * as display from "./cases/display.js";

/** Every case the fixture can mount, in the order the scene mounts them. */
export const CASE_NAMES = [
  "sprites",
  "text-ui",
  "masks",
  "render-targets",
  "effects",
  "lighting",
  "physics",
  "workers",
  "audio",
  "input",
  "saves",
  "lifecycle",
  "display",
] as const;

/** One of {@link CASE_NAMES}. */
export type CaseName = (typeof CASE_NAMES)[number];

/** What the scene needs to mount one case and read it back. */
export interface CaseDefinition {
  /** The entity the case spawns. */
  readonly Entity: new () => Entity;
  /** The component on that entity which answers for the case. */
  readonly Probe: ComponentClass<CaseProbe>;
  /** Assets the case needs loaded first. */
  readonly assets: readonly AssetHandle<unknown>[];
}

/** Every case by name. */
export const CASES: Record<CaseName, CaseDefinition> = {
  sprites: {
    Entity: sprites.SpritesCase,
    Probe: sprites.SpritesProbe,
    assets: sprites.assets,
  },
  "text-ui": {
    Entity: textUi.TextUiCase,
    Probe: textUi.TextUiProbe,
    assets: [],
  },
  masks: {
    Entity: masks.MasksCase,
    Probe: masks.MasksProbe,
    assets: masks.assets,
  },
  "render-targets": {
    Entity: renderTargets.RenderTargetsCase,
    Probe: renderTargets.RenderTargetsProbe,
    assets: [],
  },
  effects: {
    Entity: effects.EffectsCase,
    Probe: effects.EffectsProbe,
    assets: [],
  },
  lighting: {
    Entity: lighting.LightingCase,
    Probe: lighting.LightingProbe,
    assets: [],
  },
  physics: {
    Entity: physics.PhysicsCase,
    Probe: physics.PhysicsProbe,
    assets: [],
  },
  workers: {
    Entity: workers.WorkersCase,
    Probe: workers.WorkersProbe,
    assets: [],
  },
  audio: {
    Entity: audio.AudioCase,
    Probe: audio.AudioProbe,
    assets: audio.assets,
  },
  input: { Entity: input.InputCase, Probe: input.InputProbe, assets: [] },
  saves: { Entity: saves.SavesCase, Probe: saves.SavesProbe, assets: [] },
  lifecycle: {
    Entity: lifecycle.LifecycleCase,
    Probe: lifecycle.LifecycleProbe,
    assets: [],
  },
  display: {
    Entity: display.DisplayCase,
    Probe: display.DisplayProbe,
    assets: [],
  },
};

/**
 * The cases a query string asks for, read from `case`: a comma-separated list
 * of names. An absent or empty value selects every case. The result keeps
 * {@link CASE_NAMES} order whatever order the query used, and holds no
 * duplicates.
 */
export function selectCases(search: string): readonly CaseName[] {
  const requested = new URLSearchParams(search).get("case");
  if (requested === null || requested.trim() === "") return CASE_NAMES;
  const wanted = new Set<CaseName>();
  for (const part of requested.split(",")) {
    const name = part.trim();
    if (name === "") continue;
    if (!isCaseName(name)) {
      throw new Error(
        `Baseline: unknown case ${JSON.stringify(name)}. ` +
          `Known cases: ${CASE_NAMES.join(", ")}.`,
      );
    }
    wanted.add(name);
  }
  return CASE_NAMES.filter((name) => wanted.has(name));
}

function isCaseName(value: string): value is CaseName {
  return (CASE_NAMES as readonly string[]).includes(value);
}

/** The fixture's one scene: it mounts the selected cases and nothing else. */
export class BaselineScene extends Scene {
  readonly name = "baseline";
  readonly preload: readonly AssetHandle<unknown>[];
  readonly cases: readonly CaseName[];
  private readonly mounted = new Map<CaseName, CaseProbe>();

  constructor(cases: readonly CaseName[]) {
    super();
    this.cases = cases;
    this.preload = cases.flatMap((name) => CASES[name].assets);
  }

  onEnter(): void {
    for (const name of this.cases) {
      const definition = CASES[name];
      const entity = this.spawn(definition.Entity, { key: `baseline:${name}` });
      this.mounted.set(name, entity.get(definition.Probe));
    }
  }

  /** The probe of every case that mounted, in mount order. */
  get probes(): ReadonlyMap<CaseName, CaseProbe> {
    return this.mounted;
  }
}
