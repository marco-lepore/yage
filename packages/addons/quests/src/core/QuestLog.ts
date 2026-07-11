/**
 * QuestLog — the headless runtime model: quest phases (active/completed/
 * failed) plus per-objective progress counts, driven entirely by intent calls
 * (`start`/`advance`/`setProgress`/`complete`/`completeQuest`/`fail`) that emit
 * consequences (`questStarted`, `objectiveAdvanced`, `questCompleted`, …).
 *
 * The binding contract that makes a game-authored adapter a guardless
 * one-liner: `advance`/`setProgress`/`complete` on a quest that is NOT
 * currently `active` are a silent no-op (no event, no state change). A game
 * fires progress on every pickup/kill unconditionally; the log gates it.
 * Unknown ids reachable only by breaking the typed API (an objective id not
 * declared under the given quest) throw; a quest id the log has never heard
 * of behaves exactly like "not active" — no-op, no throw — since `start` is
 * the only boundary that has to report on unknown ids.
 *
 * `status()` is a pure function of stored phase + `requires`: there is no
 * separate stored "locked" state. A quest with no entry in the runtime map is
 * `locked` or `available` depending on whether its `requires` quests are all
 * `completed`.
 */

import { Emitter } from "./emitter.js";
import type { ObjectiveIdOf, QuestCatalog, QuestId } from "./catalog.js";
import type {
  ObjectiveDef,
  QuestDefInput,
  QuestEvents,
  QuestSnapshot,
  QuestStartResult,
  QuestState,
  QuestStateSnapshot,
  QuestStatus,
} from "./types.js";

interface QuestRuntimeState {
  phase: "active" | "completed" | "failed";
  /** Objective id -> progress count. Objectives never touched are absent
   *  (read as 0). */
  objectives: Map<string, number>;
}

export class QuestLog<TDefs extends Record<string, QuestDefInput> = Record<string, QuestDefInput>> {
  private readonly emitter = new Emitter<QuestEvents>();
  private readonly states = new Map<string, QuestRuntimeState>();

  constructor(private readonly catalog: QuestCatalog<TDefs>) {}

  // ------------------------------------------------------------- lifecycle

  /**
   * Activate `quest`. `{ ok: true }` when it was `available` (prereqs met,
   * not yet started). Otherwise `{ ok: false, reason }`: `"locked"` (a
   * `requires` quest isn't `completed` yet), `"already-active"`,
   * `"already-completed"` (also returned for a `failed` quest — terminal
   * states are reported the same way), or `"unknown-quest"` for an id absent
   * from the catalog (a boundary check — `start` never throws).
   */
  start(quest: QuestId<TDefs>): QuestStartResult {
    if (!this.catalog.has(quest)) return { ok: false, reason: "unknown-quest" };
    const state = this.states.get(quest);
    if (state?.phase === "active") return { ok: false, reason: "already-active" };
    if (state?.phase === "completed" || state?.phase === "failed") {
      return { ok: false, reason: "already-completed" };
    }
    const def = this.catalog.get(quest);
    const locked = def.requires.some((reqId) => this.states.get(reqId)?.phase !== "completed");
    if (locked) return { ok: false, reason: "locked" };
    this.states.set(quest, { phase: "active", objectives: new Map() });
    this.emitter.emit("questStarted", { questId: quest });
    this.emitter.emit("changed", { questId: quest });
    return { ok: true };
  }

  /**
   * Bump `objective`'s progress by `amount` (default 1), clamped to its
   * target. No-op (no event) unless `quest` is currently `active`, and
   * `amount <= 0` is always a no-op — progress never decreases via `advance`;
   * use {@link setProgress} for that. Throws if `objective` isn't declared
   * under `quest` (unreachable through the typed API — a programming error).
   */
  advance<Q extends QuestId<TDefs>>(
    quest: Q,
    objective: ObjectiveIdOf<TDefs, Q>,
    amount = 1,
  ): void {
    const state = this.states.get(quest);
    if (!state || state.phase !== "active") return;
    if (amount <= 0) return;
    const def = this.objectiveDef(quest, objective);
    const current = state.objectives.get(objective) ?? 0;
    this.applyProgress(quest, state, objective, def, Math.min(def.count, current + amount));
  }

  /**
   * Set `objective`'s progress to `count` absolutely, clamped to `[0,
   * target]` — unlike {@link advance}, this can decrease it. No-op unless
   * `quest` is `active`. Same event chain as `advance` when the value rises
   * to (or reaches) the target.
   */
  setProgress<Q extends QuestId<TDefs>>(
    quest: Q,
    objective: ObjectiveIdOf<TDefs, Q>,
    count: number,
  ): void {
    const state = this.states.get(quest);
    if (!state || state.phase !== "active") return;
    const def = this.objectiveDef(quest, objective);
    const clamped = Math.max(0, Math.min(def.count, count));
    this.applyProgress(quest, state, objective, def, clamped);
  }

  /** Drive `objective` straight to its target. No-op if `quest` isn't
   *  `active`, or if the objective is already done. */
  complete<Q extends QuestId<TDefs>>(quest: Q, objective: ObjectiveIdOf<TDefs, Q>): void {
    const state = this.states.get(quest);
    if (!state || state.phase !== "active") return;
    const def = this.objectiveDef(quest, objective);
    const current = state.objectives.get(objective) ?? 0;
    if (current >= def.count) return;
    this.applyProgress(quest, state, objective, def, def.count);
  }

  /**
   * Force-complete `quest`: every objective is marked done and the quest
   * transitions to `completed` regardless of `requires` or current phase,
   * with a single `questCompleted`. No-op if already `completed`; no-op on a
   * `failed` quest (terminal). An inactive-but-available quest activates and
   * completes in the same call (still one `questCompleted`, no `questStarted`).
   * No-op — no throw — for a quest id the catalog doesn't declare.
   */
  completeQuest(quest: QuestId<TDefs>): void {
    if (!this.catalog.has(quest)) return;
    const state = this.states.get(quest);
    if (state?.phase === "completed" || state?.phase === "failed") return;
    const def = this.catalog.get(quest);
    const next: QuestRuntimeState = state ?? { phase: "active", objectives: new Map() };
    for (const objId of def.objectiveIds) {
      next.objectives.set(objId, def.objectives.get(objId)!.count);
    }
    next.phase = "completed";
    this.states.set(quest, next);
    this.emitter.emit("questCompleted", { questId: quest });
    this.emitter.emit("changed", { questId: quest });
  }

  /** Fail `quest` — terminal in v1 (no re-open/retry). Only `active` or
   *  `available` quests can fail; already-terminal or `locked` is a no-op.
   *  No-op — no throw — for a quest id the catalog doesn't declare. */
  fail(quest: QuestId<TDefs>): void {
    if (!this.catalog.has(quest)) return;
    const state = this.states.get(quest);
    if (state?.phase === "completed" || state?.phase === "failed") return;
    const status = this.status(quest);
    if (status !== "active" && status !== "available") return;
    const next: QuestRuntimeState = state ?? { phase: "active", objectives: new Map() };
    next.phase = "failed";
    this.states.set(quest, next);
    this.emitter.emit("questFailed", { questId: quest });
    this.emitter.emit("changed", { questId: quest });
  }

  // ---------------------------------------------------------------- reads

  /** `active`/`completed`/`failed` from stored phase; otherwise `available`
   *  when every `requires` quest is `completed`, else `locked`. */
  status(quest: QuestId<TDefs>): QuestStatus {
    const state = this.states.get(quest);
    if (state) return state.phase;
    const def = this.catalog.get(quest);
    const locked = def.requires.some((reqId) => this.states.get(reqId)?.phase !== "completed");
    return locked ? "locked" : "available";
  }

  isActive(quest: QuestId<TDefs>): boolean {
    return this.states.get(quest)?.phase === "active";
  }

  isCompleted(quest: QuestId<TDefs>): boolean {
    return this.states.get(quest)?.phase === "completed";
  }

  /** Current progress count for `objective` (0 if never touched). */
  progress<Q extends QuestId<TDefs>>(quest: Q, objective: ObjectiveIdOf<TDefs, Q>): number {
    return this.states.get(quest)?.objectives.get(objective) ?? 0;
  }

  objectiveDone<Q extends QuestId<TDefs>>(quest: Q, objective: ObjectiveIdOf<TDefs, Q>): boolean {
    return this.progress(quest, objective) >= this.objectiveDef(quest, objective).count;
  }

  /** Quest ids `available` right now, in authoring order — what a
   *  quest-giver UI offers. */
  available(): QuestId<TDefs>[] {
    return this.catalog.ids.filter((id) => this.status(id) === "available");
  }

  /** Quest ids currently `active`, in authoring order. */
  active(): QuestId<TDefs>[] {
    return this.catalog.ids.filter((id) => this.status(id) === "active");
  }

  /** Quest ids `completed`, in authoring order. */
  completed(): QuestId<TDefs>[] {
    return this.catalog.ids.filter((id) => this.status(id) === "completed");
  }

  /** The full readable state of `quest` — status plus every objective's
   *  progress count (0 for untouched objectives). */
  get(quest: QuestId<TDefs>): QuestState {
    const def = this.catalog.get(quest);
    const state = this.states.get(quest);
    const objectives: Record<string, number> = {};
    for (const objId of def.objectiveIds) objectives[objId] = state?.objectives.get(objId) ?? 0;
    return Object.freeze({ status: this.status(quest), objectives: Object.freeze(objectives) });
  }

  // ------------------------------------------------------------------ events

  on<K extends keyof QuestEvents>(event: K, fn: (payload: QuestEvents[K]) => void): () => void {
    return this.emitter.on(event, fn);
  }

  // --------------------------------------------------------------- snapshot

  /** JSON-able copy of every started quest's phase + objective counts. A
   *  quest never started is absent (its status re-derives from `requires` on
   *  restore, same as before any snapshot existed). */
  snapshot(): QuestSnapshot {
    const quests: Record<string, QuestStateSnapshot> = {};
    for (const [id, state] of this.states) {
      quests[id] = { phase: state.phase, objectives: Object.fromEntries(state.objectives) };
    }
    return { quests };
  }

  /**
   * Replace the runtime state with `snapshot`. The whole blob is read and
   * validated before any current state is touched, so a malformed snapshot
   * throws and leaves prior progress intact rather than wiping it first.
   * `snapshot.quests` must be a plain object — anything else throws. Within
   * it, the same no-throw drop policy applies to every entry: a quest id the
   * current catalog no longer declares, or one whose `phase` isn't
   * `"active"`, `"completed"`, or `"failed"`, is dropped. Within a restored
   * quest, objective ids no longer declared are dropped; a non-finite
   * progress count (`NaN`, `Infinity`) is dropped the same way (reads back as
   * `0`, same as an untouched objective); a fractional count is truncated;
   * the surviving count is clamped to `[0, target]` (a catalog change since
   * the snapshot was taken never resurrects a removed quest/objective or
   * exceeds a shrunk target). Emits one coarse `changed` per restored (and
   * known) quest id — not-started quests re-derive `locked`/`available` from
   * `requires` the next time they're read.
   */
  restore(snapshot: QuestSnapshot): void {
    const quests: unknown = snapshot?.quests;
    if (typeof quests !== "object" || quests === null || Array.isArray(quests)) {
      throw new Error("QuestLog.restore: snapshot.quests must be a plain object");
    }
    const restored = new Map<string, QuestRuntimeState>();
    for (const [questId, snap] of Object.entries(quests as Record<string, QuestStateSnapshot>)) {
      if (!this.catalog.has(questId)) continue;
      if (snap.phase !== "active" && snap.phase !== "completed" && snap.phase !== "failed") continue;
      const def = this.catalog.get(questId);
      const objectives = new Map<string, number>();
      for (const [objId, count] of Object.entries(snap.objectives)) {
        const objDef = def.objectives.get(objId);
        if (!objDef || !Number.isFinite(count)) continue;
        objectives.set(objId, Math.max(0, Math.min(objDef.count, Math.trunc(count))));
      }
      restored.set(questId, { phase: snap.phase, objectives });
    }
    this.states.clear();
    for (const [questId, state] of restored) {
      this.states.set(questId, state);
      this.emitter.emit("changed", { questId });
    }
  }

  // ------------------------------------------------------------- internals

  /** The objective def for `objective` under `quest`. Throws when unreachable
   *  through the typed API — an id that isn't a declared objective. */
  private objectiveDef(quest: string, objective: string): ObjectiveDef {
    const def = this.catalog.get(quest as QuestId<TDefs>).objectives.get(objective);
    if (!def) throw new Error(`quest "${quest}": unknown objective id "${objective}"`);
    return def;
  }

  /** The shared event chain for advance/setProgress/complete: emit
   *  `objectiveAdvanced`, and — only on the transition from below target to
   *  at-or-above it — `objectiveCompleted` followed by the auto-complete
   *  rollup. Always ends with one `changed`. No-op — no event at all — when
   *  `nextProgress` equals the current value, since nothing changed. */
  private applyProgress(
    quest: string,
    state: QuestRuntimeState,
    objective: string,
    def: ObjectiveDef,
    nextProgress: number,
  ): void {
    const current = state.objectives.get(objective) ?? 0;
    if (nextProgress === current) return;
    state.objectives.set(objective, nextProgress);
    const done = nextProgress >= def.count;
    this.emitter.emit("objectiveAdvanced", {
      questId: quest,
      objectiveId: objective,
      progress: nextProgress,
      count: def.count,
      done,
    });
    const crossedToTarget = current < def.count && nextProgress >= def.count;
    if (crossedToTarget) {
      this.emitter.emit("objectiveCompleted", { questId: quest, objectiveId: objective });
      this.tryAutoComplete(quest, state);
    }
    this.emitter.emit("changed", { questId: quest });
  }

  /** After an objective crosses to done, complete the quest when every
   *  non-`optional` objective is done. Optional objectives never gate it. */
  private tryAutoComplete(quest: string, state: QuestRuntimeState): void {
    if (state.phase !== "active") return;
    const def = this.catalog.get(quest as QuestId<TDefs>);
    const allRequiredDone = def.objectiveIds.every((objId) => {
      const objDef = def.objectives.get(objId)!;
      if (objDef.optional) return true;
      return (state.objectives.get(objId) ?? 0) >= objDef.count;
    });
    if (!allRequiredDone) return;
    state.phase = "completed";
    this.emitter.emit("questCompleted", { questId: quest });
  }
}
