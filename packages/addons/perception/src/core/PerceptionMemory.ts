import { prepareSnapshot } from "./snapshot.js";
import type {
  PerceptionObservation,
  PerceptionSample,
  PerceptionSnapshot,
  PerceptionTransition,
} from "./types.js";
import { finite, nonempty, point } from "./validation.js";

/** Headless observation storage. The caller supplies monotonic simulation time. */
export class PerceptionMemory<T> {
  private entries = new Map<string, PerceptionObservation<T>>();
  private time = 0;
  private revision = 0;
  readonly memoryDuration: number;

  constructor(memoryDuration = 3) {
    this.memoryDuration = finite(
      memoryDuration,
      "PerceptionMemory.constructor",
      0,
    );
  }
  get version(): number {
    return this.revision;
  }
  get sampledAt(): number {
    return this.time;
  }
  get observations(): readonly PerceptionObservation<T>[] {
    return [...this.entries.values()];
  }
  get detected(): readonly PerceptionObservation<T>[] {
    return this.observations.filter((entry) => entry.visible);
  }
  get(id: string): PerceptionObservation<T> | undefined {
    return this.entries.get(id);
  }

  /** Complete candidate set for this sample. Missing observations are lost as "unavailable". */
  update(
    now: number,
    samples: readonly PerceptionSample<T>[],
  ): readonly PerceptionTransition<T>[] {
    this.validateTime(now, "update");
    const ids = new Set<string>();
    const checked = samples.map((sample) => {
      nonempty(sample.id, "PerceptionMemory.update id");
      if (ids.has(sample.id))
        throw new Error(`PerceptionMemory.update: duplicate id ${sample.id}`);
      ids.add(sample.id);
      if (sample.reason !== null)
        nonempty(sample.reason, "PerceptionMemory.update reason");
      return {
        ...sample,
        position: point(sample.position, "PerceptionMemory.update.position"),
        visibility: finite(
          sample.visibility,
          "PerceptionMemory.update.visibility",
          0,
          1,
        ),
      };
    });
    const next = new Map<string, PerceptionObservation<T>>();
    const transitions: PerceptionTransition<T>[] = [];
    for (const sample of checked) {
      let old = this.entries.get(sample.id);
      if (old && !Object.is(old.target, sample.target)) {
        const observation = Object.freeze({
          ...old,
          visible: false,
          reason: "replaced",
          lostAt: old.lostAt ?? now,
        });
        if (old.visible) transitions.push({ type: "lost", observation });
        transitions.push({ type: "forgotten", observation });
        old = undefined;
      }
      // A remembered observation past its deadline is forgotten before a new
      // sighting, even when no sample in between could expire it.
      if (old && !old.visible && now - old.lastSeenAt >= this.memoryDuration) {
        transitions.push({ type: "forgotten", observation: old });
        old = undefined;
      }
      if (sample.reason === null) {
        const observation = Object.freeze({
          id: sample.id,
          target: sample.target,
          visible: true,
          reason: null,
          firstSeenAt: old?.firstSeenAt ?? now,
          lastSeenAt: now,
          lostAt: null,
          lastPosition: sample.position,
          visibility: sample.visibility,
        });
        next.set(sample.id, observation);
        if (!old?.visible) transitions.push({ type: "detected", observation });
      } else if (old) {
        this.reject(old, sample.reason, now, next, transitions);
      }
    }
    for (const old of this.entries.values()) {
      if (!ids.has(old.id))
        this.reject(old, "unavailable", now, next, transitions);
    }
    this.entries = next;
    this.time = now;
    this.revision++;
    return transitions;
  }

  /** Clear all observations. The caller dispatches the returned transitions. */
  clear(now: number, reason = "cleared"): readonly PerceptionTransition<T>[] {
    this.validateTime(now, "clear");
    nonempty(reason, "PerceptionMemory.clear reason");
    const transitions: PerceptionTransition<T>[] = [];
    for (const old of this.entries.values()) {
      const observation = Object.freeze({
        ...old,
        visible: false,
        reason,
        lostAt: old.lostAt ?? now,
      });
      if (old.visible) transitions.push({ type: "lost", observation });
      transitions.push({ type: "forgotten", observation });
    }
    this.entries.clear();
    this.time = now;
    this.revision++;
    return transitions;
  }

  snapshot(now = this.time): PerceptionSnapshot {
    this.validateTime(now, "snapshot");
    return {
      version: 1,
      records: this.observations.map((entry) => ({
        id: entry.id,
        firstSeenAge: now - entry.firstSeenAt,
        lastSeenAge: now - entry.lastSeenAt,
        lostAge: entry.lostAt === null ? null : now - entry.lostAt,
        lastPosition: { ...entry.lastPosition },
        visibility: entry.visibility,
      })),
    };
  }

  /**
   * Replace memory silently with remembered, not visible, observations.
   * `resolve` maps each saved id to its runtime target; records it cannot
   * resolve and records already past `memoryDuration` are omitted.
   */
  restore(
    snapshot: PerceptionSnapshot,
    now: number,
    resolve: (id: string) => T | undefined,
  ): void {
    finite(now, "PerceptionMemory.restore time", 0);
    const prepared = prepareSnapshot(snapshot);
    const next = new Map<string, PerceptionObservation<T>>();
    for (const record of prepared.records) {
      if (record.lastSeenAge >= this.memoryDuration) continue;
      const target = resolve(record.id);
      if (target === undefined) continue;
      next.set(
        record.id,
        Object.freeze({
          id: record.id,
          target,
          visible: false,
          reason: "restored",
          firstSeenAt: now - record.firstSeenAge,
          lastSeenAt: now - record.lastSeenAge,
          lostAt: now - (record.lostAge ?? 0),
          lastPosition: record.lastPosition,
          visibility: record.visibility,
        }),
      );
    }
    this.entries = next;
    this.time = now;
    this.revision++;
  }

  private reject(
    old: PerceptionObservation<T>,
    reason: string,
    now: number,
    next: Map<string, PerceptionObservation<T>>,
    transitions: PerceptionTransition<T>[],
  ): void {
    const observation = Object.freeze({
      ...old,
      visible: false,
      reason,
      lostAt: old.lostAt ?? now,
    });
    if (old.visible) transitions.push({ type: "lost", observation });
    if (now - old.lastSeenAt >= this.memoryDuration)
      transitions.push({ type: "forgotten", observation });
    else next.set(old.id, observation);
  }
  private validateTime(now: number, method: string): void {
    finite(now, `PerceptionMemory.${method} time`, this.time);
  }
}
