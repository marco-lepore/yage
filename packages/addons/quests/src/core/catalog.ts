/**
 * The quest catalog: the game's quest definitions, validated and frozen once.
 * `defineQuests` derives each quest id from its map key, and each objective id
 * from the nested `objectives` map key — the `defineItems` id-capture pattern
 * ({@link "@yagejs-addons/inventory"}) extended one level, so every
 * {@link QuestLog} method narrows the objective id to the quest id it was
 * given: `log.advance("gatherHerbs", "herb")` type-checks, `log.advance("gatherHerbs",
 * "wolf")` doesn't.
 */

import type { ObjectiveDef, ObjectiveDefInput, QuestDef, QuestDefInput } from "./types.js";

/** The quest-id literal union a {@link defineQuests} call captures. */
export type QuestId<TDefs> = Extract<keyof TDefs, string>;

/** The objective-id literal union declared under quest `Q` — narrowed per
 *  quest, not flattened across the whole catalog. */
export type ObjectiveIdOf<TDefs, Q extends QuestId<TDefs>> = TDefs[Q] extends {
  readonly objectives: infer O;
}
  ? Extract<keyof O, string>
  : never;

/**
 * Validated, frozen quest definitions plus their authoring order (the default
 * journal sort key). Create one with {@link defineQuests}.
 */
export class QuestCatalog<
  TDefs extends Record<string, QuestDefInput> = Record<string, QuestDefInput>,
> {
  /** @internal Phantom — never present at runtime; carries the two-level id
   *  space so `QuestLog` infers it from a catalog value (the `declare readonly`
   *  brand pattern). */
  declare readonly __defs?: TDefs;
  private readonly byId: ReadonlyMap<string, QuestDef>;
  /** Quest ids in authoring order. */
  readonly ids: readonly QuestId<TDefs>[];

  /** @internal — use {@link defineQuests}. */
  constructor(defs: ReadonlyMap<string, QuestDef>) {
    this.byId = defs;
    this.ids = [...defs.keys()] as QuestId<TDefs>[];
  }

  /** The def for `quest`. Throws on an unknown id — quest ids only enter the
   *  log through catalog-checked paths, so an unknown id here is a programming
   *  error, not a data condition. */
  get(quest: QuestId<TDefs>): QuestDef {
    const def = this.byId.get(quest);
    if (!def) throw new Error(`unknown quest id "${quest}" — not in this catalog`);
    return def;
  }

  /** The def for `quest`, or `undefined` — for ids from untrusted sources
   *  (snapshots) before they enter the log. */
  tryGet(quest: string): QuestDef | undefined {
    return this.byId.get(quest);
  }

  /** Whether `quest` is declared — narrows a plain string to this catalog's ids. */
  has(quest: string): quest is QuestId<TDefs> {
    return this.byId.has(quest);
  }

  /** Objective ids declared under `quest`, in authoring order. */
  objectiveIds<Q extends QuestId<TDefs>>(quest: Q): readonly ObjectiveIdOf<TDefs, Q>[] {
    return this.get(quest).objectiveIds as ObjectiveIdOf<TDefs, Q>[];
  }
}

/**
 * Build a {@link QuestCatalog} from a map of quest definitions — the quest id
 * IS the key, and each quest's objective ids are the keys of its own
 * `objectives` map:
 *
 * ```ts
 * const quests = defineQuests({
 *   gatherHerbs: {
 *     title: "Gather Herbs",
 *     autoComplete: false,
 *     objectives: {
 *       herb: { title: "Collect red herbs", count: 5 },
 *       turnIn: { title: "Return to the healer" }, // count omitted -> target 1
 *     },
 *   },
 *   thinThePack: {
 *     title: "Thin the Pack",
 *     requires: ["gatherHerbs"], // locked until gatherHerbs is completed
 *     objectives: { wolf: { title: "Slay wolves", count: 3 } },
 *   },
 * });
 * ```
 *
 * Validates every def (non-empty `title`; integer `count >= 1` per objective;
 * at least one non-`optional` objective per quest, since an all-optional or
 * empty objective set would never gate completion; every `requires` id naming
 * a quest declared somewhere in the same call, forward references allowed) and
 * freezes it. The returned catalog's quest id AND per-quest objective id
 * types are the literal key unions, which flow through `QuestLog<TDefs>` so
 * `log.advance(quest, objective)` is fully typed with zero explicit type
 * arguments.
 */
export function defineQuests<const TDefs extends Record<string, QuestDefInput>>(
  defs: TDefs,
): QuestCatalog<TDefs> {
  const out = new Map<string, QuestDef>();
  // Pass 1: validate + build every def (requires existence checked in pass 2,
  // once every id is in `out`, so forward references resolve).
  for (const [id, input] of Object.entries(defs) as [string, QuestDefInput][]) {
    if (!input.title) throw new Error(`quest "${id}": title is required`);
    const objectiveIds = Object.keys(input.objectives);
    const objectives = new Map<string, ObjectiveDef>();
    for (const [objId, objInput] of Object.entries(input.objectives) as [
      string,
      ObjectiveDefInput,
    ][]) {
      const count = objInput.count ?? 1;
      if (!Number.isInteger(count) || count < 1) {
        throw new Error(
          `quest "${id}": objective "${objId}" count must be an integer >= 1 (got ${count})`,
        );
      }
      objectives.set(objId, Object.freeze({ ...objInput, id: objId, count }));
    }
    const hasNonOptionalObjective = [...objectives.values()].some((o) => !o.optional);
    if (!hasNonOptionalObjective) {
      throw new Error(`quest "${id}": must declare at least one non-optional objective`);
    }
    out.set(
      id,
      Object.freeze({
        ...input,
        id,
        objectives,
        objectiveIds,
        autoComplete: input.autoComplete ?? true,
        requires: input.requires ?? [],
      }),
    );
  }
  for (const [id, def] of out) {
    for (const reqId of def.requires) {
      if (!out.has(reqId)) throw new Error(`quest "${id}": requires unknown quest "${reqId}"`);
    }
  }
  return new QuestCatalog<TDefs>(out);
}
