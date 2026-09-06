import type { DocumentCommand } from "../../shared/commands/index.js";
import type { HistorySummary } from "../../shared/protocol/index.js";

/** One accepted edit, with the command each direction replays. */
export interface HistoryEntry {
  /** Applied again by a redo. */
  readonly command: DocumentCommand;
  /**
   * Applied by an undo. The reducer builds it from the document the command
   * was reduced against, so it restores that document exactly.
   */
  readonly inverse: DocumentCommand;
}

/** The command an undo or a redo applies, and the history that follows it. */
export interface HistoryStep {
  readonly command: DocumentCommand;
  readonly next: DraftHistory;
}

/**
 * One level's undo history.
 *
 * Every transition returns a new history rather than changing this one, so the
 * caller commits only after the command it handed back has actually applied. A
 * reduction that fails leaves the history it came from untouched, which is why
 * a rejected undo cannot consume the entry it was about to replay.
 */
export class DraftHistory {
  private constructor(
    /** Newest last: an undo takes the end. */
    private readonly done: readonly HistoryEntry[],
    /** Newest last: a redo takes the end. */
    private readonly undone: readonly HistoryEntry[],
    private readonly bound: number,
  ) {}

  static empty(bound: number): DraftHistory {
    return new DraftHistory([], [], bound);
  }

  /**
   * A newly accepted edit. Recording one discards what was undone, because the
   * document those entries would redo onto no longer exists.
   */
  record(entry: HistoryEntry): DraftHistory {
    const done = [...this.done, entry];
    // Losing the oldest edit needs no report: the summary already says how deep
    // the history goes, and the control reads it.
    if (done.length > this.bound) done.splice(0, done.length - this.bound);
    return new DraftHistory(done, [], this.bound);
  }

  undo(): HistoryStep | undefined {
    const entry = this.done.at(-1);
    if (!entry) return undefined;
    return {
      command: entry.inverse,
      next: new DraftHistory(
        this.done.slice(0, -1),
        [...this.undone, entry],
        this.bound,
      ),
    };
  }

  redo(): HistoryStep | undefined {
    const entry = this.undone.at(-1);
    if (!entry) return undefined;
    return {
      command: entry.command,
      next: new DraftHistory(
        [...this.done, entry],
        this.undone.slice(0, -1),
        this.bound,
      ),
    };
  }

  get summary(): HistorySummary {
    return { undoDepth: this.done.length, redoDepth: this.undone.length };
  }
}
