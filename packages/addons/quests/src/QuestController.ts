/**
 * QuestController — the thin, optional YAGE host for a {@link QuestLog}. It
 * owns no quest logic; it just mirrors the log's six model events onto its
 * host entity as engine-bus events, for a HUD/achievements listener that
 * shouldn't need to hold a `log` reference directly.
 *
 * Entirely optional: `log` is usable standalone with no component at all
 * (`log.on("questCompleted", …)` reaches the same consequences). Mount it on
 * any persistent entity — there's no per-frame work, so it never needs
 * `update`.
 */

import { Component } from "@yagejs/core";
import type { QuestLog } from "./core/QuestLog.js";
import type { QuestDefInput } from "./core/types.js";
import {
  QuestChangedEvent,
  QuestCompletedEvent,
  QuestFailedEvent,
  QuestObjectiveProgressChangedEvent,
  QuestObjectiveCompletedEvent,
  QuestStartedEvent,
} from "./events.js";

export interface QuestControllerOptions<
  TDefs extends Record<string, QuestDefInput> = Record<string, QuestDefInput>,
> {
  readonly log: QuestLog<TDefs>;
}

export class QuestController<
  TDefs extends Record<string, QuestDefInput> = Record<string, QuestDefInput>,
> extends Component {
  private readonly unsubs: (() => void)[] = [];

  constructor(private readonly opts: QuestControllerOptions<TDefs>) {
    super();
  }

  /** The hosted model — the escape hatch to call `start`/`advance`/… directly. */
  get log(): QuestLog<TDefs> {
    return this.opts.log;
  }

  onEnable(): void {
    if (this.unsubs.length > 0) return;
    const log = this.opts.log;
    this.unsubs.push(
      log.on("questStarted", (e) => this.entity.emit(QuestStartedEvent, e)),
      log.on("objectiveProgressChanged", (e) =>
        this.entity.emit(QuestObjectiveProgressChangedEvent, e),
      ),
      log.on("objectiveCompleted", (e) =>
        this.entity.emit(QuestObjectiveCompletedEvent, e),
      ),
      log.on("questCompleted", (e) => this.entity.emit(QuestCompletedEvent, e)),
      log.on("questFailed", (e) => this.entity.emit(QuestFailedEvent, e)),
      log.on("changed", (e) => this.entity.emit(QuestChangedEvent, e)),
    );
  }

  onDisable(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
  }

  onDestroy(): void {
    this.onDisable();
  }
}
