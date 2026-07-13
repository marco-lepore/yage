/**
 * Types for the quest catalog and runtime log. `QuestDefInput`/`ObjectiveDefInput`
 * are what a game authors via {@link defineQuests}; `QuestDef`/`ObjectiveDef` are
 * the validated, frozen results a {@link QuestCatalog} holds.
 */

export interface ObjectiveDefInput {
  /** Shown by a journal/tracker. Optional — quests are addressable by id even
   *  without display text (see the localization note on {@link QuestDefInput}). */
  readonly title?: string;
  readonly description?: string;
  /** Progress target. Omit for a target of 1 (a single done/not-done step). */
  readonly count?: number;
  /** Excluded from the quest's auto-complete rollup — the quest can complete
   *  while this objective is still incomplete. Default false. */
  readonly optional?: boolean;
}

/** A validated objective def — {@link ObjectiveDefInput} plus its id (the map
 *  key it was declared under) and a defaulted `count`. */
export interface ObjectiveDef extends ObjectiveDefInput {
  readonly id: string;
  readonly count: number;
}

export interface QuestDefInput {
  readonly title: string;
  readonly summary?: string;
  /** Objective ids and their defs — the id IS the key, same as
   *  {@link defineQuests}'s own quest-id map. */
  readonly objectives: Record<string, ObjectiveDefInput>;
  /** Whether satisfying every required objective completes the quest
   *  immediately. Set to `false` for quests that require an explicit turn-in
   *  while their objectives may become incomplete again. Default `true`. */
  readonly autoComplete?: boolean;
  /** Quest ids that must be `completed` before this one unlocks. Forward
   *  references (naming a quest declared later in the same call) are allowed;
   *  naming a quest absent from the whole map throws. */
  readonly requires?: readonly string[];
}

/** A validated quest def — {@link QuestDefInput} plus its id, resolved
 *  objective defs, and `requires` defaulted to `[]`. */
export interface QuestDef {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly objectives: ReadonlyMap<string, ObjectiveDef>;
  /** Objective ids in authoring order (the journal sort key). */
  readonly objectiveIds: readonly string[];
  readonly autoComplete: boolean;
  readonly requires: readonly string[];
}

export type QuestStatus = "locked" | "available" | "active" | "completed" | "failed";

/** The full readable state of one quest — what a journal/tracker reads. */
export interface QuestState {
  readonly status: QuestStatus;
  /** Progress count per objective id, `0` for objectives not yet touched. */
  readonly objectives: Readonly<Record<string, number>>;
}

export interface QuestStartResult {
  readonly ok: boolean;
  readonly reason?: "locked" | "already-active" | "already-completed" | "unknown-quest";
}

/** {@link QuestLog}'s model events (`log.on(event, fn)`). */
export interface QuestEvents {
  questStarted: { questId: string };
  objectiveProgressChanged: {
    questId: string;
    objectiveId: string;
    progress: number;
    count: number;
    done: boolean;
  };
  objectiveCompleted: { questId: string; objectiveId: string };
  questCompleted: { questId: string };
  questFailed: { questId: string };
  /** Coarse re-render signal — fires after the fine-grained event(s) above,
   *  once per mutating call. */
  changed: { questId: string };
}

/** A started quest's plain-JSON state — the unit {@link QuestLog.snapshot}
 *  returns per quest id. Not-started quests aren't recorded; their status
 *  re-derives from `requires` on restore. */
export interface QuestStateSnapshot {
  readonly phase: "active" | "completed" | "failed";
  readonly objectives: Readonly<Record<string, number>>;
}

export interface QuestSnapshot {
  readonly quests: Readonly<Record<string, QuestStateSnapshot>>;
}
