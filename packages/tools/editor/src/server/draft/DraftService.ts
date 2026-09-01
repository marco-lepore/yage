import { readLevel } from "@yagejs/level/document";
import type { LevelDocument, StructuralError } from "@yagejs/level/document";
import {
  CommandPreconditionError,
  reduceCommand,
  type DocumentCommand,
  type ReduceResult,
} from "../../shared/commands/index.js";
import type {
  BootstrapResponse,
  DraftCommandRequest,
  DraftOutcome,
  DraftRejectionCode,
  DraftSaveRequest,
  DraftSnapshot,
  RevisionedRequest,
} from "../../shared/protocol/index.js";
import type { LevelFileService } from "../files/index.js";
import { DraftHistory, type HistoryStep } from "./DraftHistory.js";
import { SerialQueue } from "./SerialQueue.js";

export interface DraftServiceOptions {
  readonly files: LevelFileService;
  readonly projectId: string;
  /** Unique per boot. Injected so tests are deterministic. */
  readonly epoch: string;
  /** How many recent accepted revisions stay addressable. */
  readonly retainedRevisions?: number;
  /** How many edits one level's history holds. */
  readonly historyEntries?: number;
}

/** One level's unsaved work, owned entirely by this service. */
interface LevelState {
  readonly path: string;
  document: LevelDocument;
  /** Hash of the canonical draft, kept beside the document it describes. */
  contentHash: string;
  draftRevision: number;
  /** Hash of the bytes on disk the draft was last synced with. */
  diskRevision: string;
  savedContentHash: string;
  /** Recent accepted revisions, oldest first, so a save can address one. */
  readonly retained: Map<number, LevelDocument>;
  history: DraftHistory;
}

/** A reduction that has not been committed to a level's state yet. */
interface Applied {
  readonly document: LevelDocument;
  readonly contentHash: string;
  readonly inverse: DocumentCommand;
}

const DEFAULT_RETAINED_REVISIONS = 64;

/**
 * Phase 0 measured a 100-entry history at about 19 KB over a 60-placement
 * document, which is what a recovery record has to carry.
 */
const DEFAULT_HISTORY_ENTRIES = 100;

/**
 * The authoritative owner of unsaved work.
 *
 * Each level has one serial queue, and a queue step runs a whole transition:
 * compare the request's preconditions, apply, validate the result, advance the
 * revision, and answer. Two commands sent against one revision therefore give
 * one acceptance and one stale response rather than one silently overwriting
 * the other.
 *
 * The undo history is here rather than in the browser for the reason the draft
 * is: a reload must not lose it. Undo and redo are queue steps like a command,
 * so an undo racing an edit is decided the same way two edits are.
 *
 * The browser holds a projection of this state, never the state itself.
 */
export class DraftService {
  private readonly files: LevelFileService;
  private readonly retainedRevisions: number;
  private readonly historyEntries: number;
  private readonly states = new Map<string, LevelState>();
  private readonly queues = new Map<string, SerialQueue>();
  private readonly projectId: string;
  private readonly epoch: string;

  constructor(options: DraftServiceOptions) {
    this.files = options.files;
    this.projectId = options.projectId;
    this.epoch = options.epoch;
    this.retainedRevisions =
      options.retainedRevisions ?? DEFAULT_RETAINED_REVISIONS;
    this.historyEntries = options.historyEntries ?? DEFAULT_HISTORY_ENTRIES;
  }

  async bootstrap(): Promise<BootstrapResponse> {
    return {
      projectId: this.projectId,
      epoch: this.epoch,
      levels: await this.files.listLevels(),
    };
  }

  /** One atomic read of everything a browser needs to open a level. */
  snapshot(path: string): Promise<DraftOutcome> {
    return this.queueFor(path).run(async () => {
      const opened = await this.open(path);
      if ("rejection" in opened) return opened.rejection;
      return { status: "accepted", snapshot: this.toSnapshot(opened.state) };
    });
  }

  command(path: string, request: DraftCommandRequest): Promise<DraftOutcome> {
    return this.queueFor(path).run(async () => {
      const epochCheck = this.checkEpoch(path, request.epoch);
      if (epochCheck) return epochCheck;
      const opened = await this.open(path);
      if ("rejection" in opened) return opened.rejection;
      const { state } = opened;

      if (request.expectedDraftRevision !== state.draftRevision) {
        return { status: "stale", snapshot: this.toSnapshot(state) };
      }

      const applied = this.apply(state, request.command);
      if ("rejection" in applied) return applied.rejection;

      // An edit that changes nothing is not an edit. It costs no revision and
      // leaves the history alone, so a drag that ends where it started neither
      // adds a dead undo step nor discards what could still be redone.
      if (applied.contentHash === state.contentHash) {
        return { status: "accepted", snapshot: this.toSnapshot(state) };
      }

      this.commit(state, applied);
      state.history = state.history.record({
        command: request.command,
        inverse: applied.inverse,
      });
      return { status: "accepted", snapshot: this.toSnapshot(state) };
    });
  }

  /** Replay the newest edit's inverse. */
  undo(path: string, request: RevisionedRequest): Promise<DraftOutcome> {
    return this.step(path, request, (history) => history.undo());
  }

  /** Replay the newest undone edit. */
  redo(path: string, request: RevisionedRequest): Promise<DraftOutcome> {
    return this.step(path, request, (history) => history.redo());
  }

  /**
   * Undo and redo are the same operation over a different end of the history:
   * take the command that direction replays, apply it like any other, and move
   * the entry across only once it has.
   */
  private step(
    path: string,
    request: RevisionedRequest,
    pick: (history: DraftHistory) => HistoryStep | undefined,
  ): Promise<DraftOutcome> {
    return this.queueFor(path).run(async () => {
      const epochCheck = this.checkEpoch(path, request.epoch);
      if (epochCheck) return epochCheck;
      const opened = await this.open(path);
      if ("rejection" in opened) return opened.rejection;
      const { state } = opened;

      if (request.expectedDraftRevision !== state.draftRevision) {
        return { status: "stale", snapshot: this.toSnapshot(state) };
      }

      // Nothing to replay is not a failure: the summary the browser already
      // holds says so, and a control that asks anyway learns the same thing.
      const step = pick(state.history);
      if (!step)
        return { status: "accepted", snapshot: this.toSnapshot(state) };

      const applied = this.apply(state, step.command);
      if ("rejection" in applied) return applied.rejection;
      this.commit(state, applied);
      state.history = step.next;
      return { status: "accepted", snapshot: this.toSnapshot(state) };
    });
  }

  /**
   * Reduce a command against a level's document and check the result is still
   * a level. It changes nothing: a caller commits what comes back, so a
   * rejection leaves the draft and its history exactly as they were.
   *
   * The structural check runs on every applied command, including the inverses
   * undo and redo replay. The wire check reads only the two fields the reducer
   * reads, so this is the one place a bad transform or type is caught, and a
   * document that "came from us" was still built from what a browser sent.
   */
  private apply(
    state: LevelState,
    command: DocumentCommand,
  ): Applied | { rejection: Extract<DraftOutcome, { status: "rejected" }> } {
    let reduced: ReduceResult;
    try {
      reduced = reduceCommand(state.document, command);
    } catch (error) {
      if (error instanceof CommandPreconditionError) {
        return {
          rejection: this.reject("invalid-command", error.message, state),
        };
      }
      throw error;
    }

    const structural = readLevel(reduced.document);
    if (!structural.ok) {
      return {
        rejection: this.reject(
          "structurally-invalid",
          `The edit would produce an invalid document: ${describe(structural.errors)}`,
          state,
        ),
      };
    }
    // Commit what the document layer read, not what the reducer produced. A
    // placement arriving on the wire may omit a field the format supplies a
    // default for, and the reducer passes it through untouched: formatting
    // that raw object writes a different level than the one this check
    // approved, or throws on the field it is missing.
    return {
      document: structural.document,
      contentHash: this.files.hashCanonical(structural.document),
      inverse: reduced.inverse,
    };
  }

  /** Make an applied document the draft, at a new revision. */
  private commit(state: LevelState, applied: Applied): void {
    state.document = applied.document;
    state.contentHash = applied.contentHash;
    state.draftRevision += 1;
    this.retain(state);
  }

  /**
   * Promote one exact accepted revision to disk.
   *
   * The request carries no document: the server writes the draft it already
   * holds at that revision, so a save cannot smuggle in state the queue never
   * accepted. Edits made while the save was in flight stay unsaved, and the
   * draft stays dirty.
   */
  save(path: string, request: DraftSaveRequest): Promise<DraftOutcome> {
    return this.queueFor(path).run(async () => {
      const epochCheck = this.checkEpoch(path, request.epoch);
      if (epochCheck) return epochCheck;
      const opened = await this.open(path);
      if ("rejection" in opened) return opened.rejection;
      const { state } = opened;

      if (request.expectedDiskRevision !== state.diskRevision) {
        return this.reject(
          "stale-disk",
          "The file changed on disk since this draft was synced with it.",
          state,
        );
      }
      const document = state.retained.get(request.expectedDraftRevision);
      if (!document) {
        return this.reject(
          "unretained-revision",
          `Draft revision ${request.expectedDraftRevision} is no longer retained.`,
          state,
        );
      }

      const written = await this.files.writeLevel(
        state.path,
        document,
        state.diskRevision,
      );
      if (!written.ok) {
        return written.reason === "stale-disk"
          ? this.reject(
              "stale-disk",
              "The file changed on disk while the save was running.",
              state,
            )
          : this.reject(
              "write-failed",
              `Writing "${state.path}" failed; the file on disk is unchanged.`,
              state,
            );
      }

      state.diskRevision = written.diskRevision;
      state.savedContentHash = written.contentHash;
      return { status: "accepted", snapshot: this.toSnapshot(state) };
    });
  }

  /**
   * The level's state, read from disk the first time it is asked for. A level
   * nobody opened costs nothing, and opening one is a queue step like any
   * other.
   */
  private async open(
    path: string,
  ): Promise<
    | { state: LevelState }
    | { rejection: Extract<DraftOutcome, { status: "rejected" }> }
  > {
    const existing = this.states.get(path);
    if (existing) return { state: existing };

    const read = await this.files.readLevel(path);
    if (!read.ok) {
      return {
        rejection: this.reject(
          "missing-file",
          MISSING_MESSAGES[read.reason](path),
        ),
      };
    }
    if (!read.structural.ok) {
      return {
        rejection: this.reject(
          "structurally-invalid",
          `"${path}" is not a valid level file: ${describe(read.structural.errors)}`,
        ),
      };
    }

    const document = read.structural.document;
    const contentHash = this.files.hashCanonical(document);
    const state: LevelState = {
      path,
      document,
      contentHash,
      draftRevision: 0,
      diskRevision: read.diskRevision,
      savedContentHash: contentHash,
      retained: new Map([[0, document]]),
      history: DraftHistory.empty(this.historyEntries),
    };
    this.states.set(path, state);
    return { state };
  }

  private checkEpoch(
    path: string,
    epoch: string,
  ): Extract<DraftOutcome, { status: "rejected" }> | undefined {
    if (epoch === this.epoch) return undefined;
    return this.reject("epoch-mismatch", EPOCH_MESSAGE, this.states.get(path));
  }

  private reject(
    code: DraftRejectionCode,
    message: string,
    state?: LevelState,
  ): Extract<DraftOutcome, { status: "rejected" }> {
    return state
      ? { status: "rejected", code, message, snapshot: this.toSnapshot(state) }
      : { status: "rejected", code, message };
  }

  private toSnapshot(state: LevelState): DraftSnapshot {
    return {
      path: state.path,
      epoch: this.epoch,
      document: state.document,
      draftRevision: state.draftRevision,
      diskRevision: state.diskRevision,
      contentHash: state.contentHash,
      savedContentHash: state.savedContentHash,
      dirty: state.contentHash !== state.savedContentHash,
      history: state.history.summary,
    };
  }

  private retain(state: LevelState): void {
    state.retained.set(state.draftRevision, state.document);
    while (state.retained.size > this.retainedRevisions) {
      const oldest = state.retained.keys().next();
      if (oldest.done) break;
      state.retained.delete(oldest.value);
    }
  }

  private queueFor(path: string): SerialQueue {
    let queue = this.queues.get(path);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(path, queue);
    }
    return queue;
  }
}

const EPOCH_MESSAGE =
  "The editor server restarted; refetch bootstrap and the draft snapshot.";

const MISSING_MESSAGES = {
  "not-found": (path: string) => `No level file at "${path}".`,
  "outside-roots": (path: string) =>
    `"${path}" is not one of the configured levels.`,
  unreadable: (path: string) => `"${path}" could not be read.`,
} as const;

function describe(errors: readonly StructuralError[]): string {
  return errors
    .slice(0, 3)
    .map((error) => `${error.path || "<root>"} ${error.message}`)
    .join("; ");
}
