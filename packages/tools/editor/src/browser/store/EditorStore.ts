import type { LevelDocument } from "@yagejs/level/document";
import {
  CommandPreconditionError,
  reduceCommand,
  type DocumentCommand,
  type PoseEdit,
  type PreviewImpact,
} from "../../shared/commands/index.js";
import type {
  DiagnosticSource,
  EditorDiagnostic,
} from "../../shared/diagnostics/index.js";
import type {
  DraftCommandRequest,
  DraftOutcome,
  DraftSnapshot,
  LevelSummary,
  RevisionedRequest,
} from "../../shared/protocol/index.js";
import type {
  EditGesture,
  EditorAction,
  EditorFileState,
  EditorState,
  EditorViewState,
  ParamDrag,
  PendingCommand,
  PoseDraft,
  ReferencePick,
  WriteLockReason,
} from "./types.js";
import {
  DEFAULT_VIEW,
  openingView,
  normalizedView,
  pannedView,
  parseView,
  serializeView,
  toggledGuides,
  toggledSnap,
  withStep,
  viewStorageKey,
  zoomedViewAt,
  type ViewStorage,
} from "./view.js";

/**
 * The state before a level is open. Its emptiness is what every reader sees
 * until `level-opened` arrives, so nothing has to branch on "no document yet".
 * It is never sent anywhere: a save promotes a revision the server already
 * holds, and this document has none.
 */
export const EMPTY_LEVEL_DOCUMENT: LevelDocument = {
  format: "yage-level",
  version: 1,
  id: "",
  metadata: {},
  entities: [],
  extensions: {},
};

/**
 * How many times one command is re-sent against a newer revision before the
 * browser gives up on it. A command that keeps losing is losing to edits the
 * user can see; retrying forever would hold the write lock open with no end.
 */
export const MAX_REBASES = 3;

/**
 * The calls the store makes. `EditorApiClient` satisfies them; naming them
 * rather than the class keeps the store's dependency to what it uses.
 */
export interface DraftApi {
  sendCommand(
    path: string,
    request: DraftCommandRequest,
  ): Promise<DraftOutcome>;
  undo(path: string, request: RevisionedRequest): Promise<DraftOutcome>;
  redo(path: string, request: RevisionedRequest): Promise<DraftOutcome>;
}

/** Which end of the history a draft operation replays from. */
export type HistoryDirection = "undo" | "redo";

/** The history a level starts with, and the one an unopened editor shows. */
const NO_HISTORY = { undoDepth: 0, redoDepth: 0 };

export interface EditorStoreOptions {
  readonly api: DraftApi;
  /** The server boot this browser is paired with; every write carries it. */
  readonly epoch: string;
  /** Names whose stored views these are, so two projects cannot share one. */
  readonly projectId: string;
  /** The levels the server listed at bootstrap. Empty for a project with none. */
  readonly levels: readonly LevelSummary[];
  /** Omitted when the page has no usable storage; the view then starts fresh. */
  readonly storage?: ViewStorage | undefined;
}

type Listener = (state: EditorState, action: EditorAction) => void;

/**
 * The single owner of browser editor state.
 *
 * It holds the committed draft, the commands sent but not yet accepted, and
 * the optimistic projection of the two. A command is applied locally the
 * moment it is produced and sent at the same time; when the server answers
 * `stale`, the newer draft becomes the committed state and the command is
 * replayed on top of it. Nothing else may write the document.
 */
export class EditorStore {
  private state: EditorState = {
    levels: [],
    committed: { document: EMPTY_LEVEL_DOCUMENT, draftRevision: 0 },
    pending: [],
    document: EMPTY_LEVEL_DOCUMENT,
    selection: new Set(),
    hidden: new Set(),
    clipboard: [],
    view: DEFAULT_VIEW,
    tool: "translate",
    // What a single selection has always done: the gizmo lies along the
    // placement's own axes and turns about its own origin. Both toggles are
    // additive from here.
    pivot: "active",
    axes: "local",
    history: NO_HISTORY,
    diagnostics: new Map(),
    writesLocked: [],
  };
  private readonly listeners = new Set<Listener>();
  /** History steps sent and not yet answered. The barrier waits on these. */
  private readonly steps = new Set<Promise<void>>();
  private readonly api: DraftApi;
  private readonly epoch: string;
  private readonly projectId: string;
  /** Cleared for the session the first time storage refuses a call. */
  private storage: ViewStorage | undefined;
  /**
   * Whether the view on screen is one the developer settled on — remembered
   * for this level, or reached by panning, zooming or framing since it opened.
   * False means it is still the opening view, which a pane measurement may
   * replace.
   */
  private viewChosen = false;

  constructor(options: EditorStoreOptions) {
    this.api = options.api;
    this.epoch = options.epoch;
    this.projectId = options.projectId;
    this.storage = options.storage;
    this.state = { ...this.state, levels: options.levels };
  }

  getState(): EditorState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispatch(action: EditorAction): void {
    let next = reduce(this.state, action);
    // The view a level was last edited from is restored with the level, in the
    // same transition, so a listener never sees the new document under the old
    // camera.
    if (action.type === "level-opened") {
      const stored = this.readStoredView(action.snapshot.path);
      this.viewChosen = stored !== undefined;
      next = { ...next, view: stored ?? openingView(next.viewport) };
    }
    // The pane is measured after the shell mounts, so the first level can open
    // before there is anything to derive an opening zoom from. Only the first
    // measurement fixes that view up, and only while the developer has not
    // moved it: every later one is a pane that changed size, which moves the
    // view by the rule `viewAfterResize` states rather than reframing it.
    if (
      action.type === "viewport-measured" &&
      !this.viewChosen &&
      this.state.viewport === undefined
    ) {
      next = { ...next, view: openingView(action.viewport) };
    }
    this.state = next;
    if (isViewAction(action)) {
      this.storeView(next.view);
      this.viewChosen = true;
    }
    for (const listener of this.listeners) listener(this.state, action);
  }

  lockWrites(reason: WriteLockReason): void {
    this.dispatch({ type: "writes-locked", reason });
  }

  /** False while any lock is held; save and new commands both check it. */
  get writable(): boolean {
    return this.state.writesLocked.length === 0;
  }

  /**
   * Returns the open gesture and clears it. `CommandController` calls this to
   * turn a finished drag into one command; the gesture cannot commit twice
   * because the second call finds nothing.
   */
  takeGesture(): EditGesture | undefined {
    const gesture = this.state.gesture;
    if (gesture) this.dispatch({ type: "gesture-ended" });
    return gesture;
  }

  /**
   * Returns the number a field is stepping and clears it, the way
   * {@link takeGesture} does — so a draft cannot be turned into a command
   * twice, whichever of the field's own commit and `settleEdits` gets there
   * first.
   */
  takePoseDraft(): PoseDraft | undefined {
    const draft = this.state.poseDraft;
    if (draft) this.dispatch({ type: "pose-draft-dropped" });
    return draft;
  }

  /**
   * Returns the parameter handle being dragged and clears it, the way
   * {@link takeGesture} does — so one drag cannot become two commands.
   */
  takeParamDrag(): ParamDrag | undefined {
    const drag = this.state.paramDrag;
    if (drag) this.dispatch({ type: "param-drag-ended" });
    return drag;
  }

  /**
   * Apply a command to the projection and send it.
   *
   * Refused while writes are locked, and refused when the command cannot apply
   * to the current document — a placement deleted underneath it, for example.
   */
  submit(command: DocumentCommand): void {
    if (!this.writable) return;
    const path = this.state.file?.path;
    if (path === undefined) return;
    let affected: readonly string[];
    let impact: PreviewImpact;
    try {
      ({ affected, impact } = reduceCommand(this.state.document, command));
    } catch (error) {
      if (!(error instanceof CommandPreconditionError)) throw error;
      this.report({
        code: "command-dropped",
        severity: "error",
        source: "validation",
        message: error.message,
        revision: this.state.committed.draftRevision,
      });
      return;
    }
    this.dispatch({ type: "command-applied", command, affected, impact });
    void this.send(path, command);
  }

  /**
   * Ask the server to replay one history entry.
   *
   * Nothing is applied optimistically: the browser does not hold the entry the
   * server would replay, so there is nothing to apply until the answer
   * arrives. That is also why this never enters {@link submit} — `pending` is
   * keyed by `commandId`, and an inverse carries the id of the command it
   * undoes.
   *
   * An operation with an empty stack is not an error. The server answers
   * `accepted` with the current snapshot and the mirrored depths say so.
   */
  step(direction: HistoryDirection): void {
    if (!this.writable) return;
    const path = this.state.file?.path;
    if (path === undefined) return;
    const running = this.sendStep(path, direction, 0).finally(() => {
      this.steps.delete(running);
    });
    this.steps.add(running);
  }

  /**
   * Resolves once every history step in flight when this was called has been
   * answered.
   *
   * The barrier needs it as much as it needs {@link awaitResolved}. A save
   * sends the revision the browser last committed, and an undo the server has
   * accepted moves that revision — so a save that did not wait promotes the
   * document from before the undo and is told it succeeded. A step never
   * enters `pending`, so waiting on commands alone does not cover one.
   */
  async awaitSteps(): Promise<void> {
    await Promise.all([...this.steps]);
  }

  /**
   * Resolves once every command in `ids` has left the pending set, whether the
   * server accepted it or the browser dropped it.
   *
   * It waits on the ids that exist when it is called, not on the pending set
   * becoming empty: a rebase re-sends and the user can keep dragging, so the
   * live set can refill faster than it drains and the wait would never end.
   */
  async awaitResolved(ids: readonly string[]): Promise<void> {
    const waiting = new Set(ids);
    const isPending = (state: EditorState): boolean =>
      state.pending.some((entry) => waiting.has(entry.command.commandId));
    if (!isPending(this.state)) return;
    await new Promise<void>((resolve) => {
      const stop = this.subscribe((state) => {
        if (isPending(state)) return;
        stop();
        resolve();
      });
    });
  }

  private async send(path: string, command: DocumentCommand): Promise<void> {
    const commandId = command.commandId;
    let outcome: DraftOutcome;
    // Only the request is guarded. Everything the client throws is a transport
    // failure by its own contract; a throw from the dispatches below is a
    // defect, and turning it into a diagnostic would report it as the server's
    // fault.
    try {
      outcome = await this.api.sendCommand(path, {
        epoch: this.epoch,
        // Read at send time, so a rebased command carries the revision it is
        // being replayed against rather than the one it was authored against.
        expectedDraftRevision: this.state.committed.draftRevision,
        command,
      });
    } catch (error) {
      this.drop(commandId, {
        code: "server-rejected",
        severity: "error",
        source: "server",
        message: error instanceof Error ? error.message : String(error),
        revision: this.state.committed.draftRevision,
      });
      return;
    }

    if (outcome.status === "accepted") {
      this.dispatch({
        type: "command-accepted",
        commandId,
        snapshot: outcome.snapshot,
      });
      return;
    }
    if (outcome.status === "stale") {
      const rebases = this.rebasesOf(commandId);
      // The command left the pending set while the answer was in flight.
      if (rebases === undefined) return;
      if (rebases >= MAX_REBASES) {
        this.drop(
          commandId,
          dropDiagnostic(command, outcome.snapshot.draftRevision),
          outcome.snapshot,
        );
        this.lockWrites("stale-command");
        return;
      }
      this.dispatch({
        type: "command-rebased",
        commandId,
        snapshot: outcome.snapshot,
      });
      // Adopting the newer draft replays the pending commands on it, and that
      // replay drops any command the newer draft made impossible. Re-sending
      // one of those would ask the server for an edit the browser has already
      // discarded, and its refusal would surface as an error about work the
      // user can no longer see.
      if (this.rebasesOf(commandId) === undefined) return;
      await this.send(path, command);
      return;
    }
    this.drop(
      commandId,
      {
        code: "server-rejected",
        severity: "error",
        source: "server",
        message: outcome.message,
        revision: this.state.committed.draftRevision,
      },
      outcome.snapshot,
    );
  }

  /**
   * One attempt at a history step, re-sent against the newer revision when the
   * server answers `stale`.
   *
   * It re-sends rather than giving up because there is nothing to replay
   * locally: the entry stays on the server's stack, and the loser of a race
   * still has one to spend. The budget is {@link MAX_REBASES} re-sends, the
   * same one a command gets — past it something is writing faster than this
   * browser can address a revision, and saying so beats retrying forever.
   */
  private async sendStep(
    path: string,
    direction: HistoryDirection,
    attempt: number,
  ): Promise<void> {
    const request: RevisionedRequest = {
      epoch: this.epoch,
      expectedDraftRevision: this.state.committed.draftRevision,
    };
    let outcome: DraftOutcome;
    try {
      outcome =
        direction === "undo"
          ? await this.api.undo(path, request)
          : await this.api.redo(path, request);
    } catch (error) {
      this.report({
        code: "server-rejected",
        severity: "error",
        source: "server",
        message: error instanceof Error ? error.message : String(error),
        revision: this.state.committed.draftRevision,
      });
      return;
    }

    if (outcome.status === "rejected") {
      // The snapshot first, so the reported revision is the one the editor is
      // left showing rather than the one the refused request addressed.
      if (outcome.snapshot) {
        this.dispatch({ type: "history-stepped", snapshot: outcome.snapshot });
      }
      this.report({
        code: "server-rejected",
        severity: "error",
        source: "server",
        message: outcome.message,
        revision: this.state.committed.draftRevision,
      });
      return;
    }

    this.dispatch({ type: "history-stepped", snapshot: outcome.snapshot });
    if (outcome.status === "accepted") return;
    // One send plus MAX_REBASES re-sends, which is what a command gets.
    if (attempt >= MAX_REBASES) {
      this.report({
        code: "command-dropped",
        severity: "error",
        source: "validation",
        message:
          `${direction === "undo" ? "Undo" : "Redo"} could not reach a ` +
          `current revision after ${MAX_REBASES} attempts.`,
        revision: this.state.committed.draftRevision,
      });
      return;
    }
    // Writes can have been locked while the answer was in flight.
    if (!this.writable) return;
    // So can the level have changed. `path` is the one this step was issued
    // against, and a re-send carries the revision the store holds now — which
    // belongs to the level on screen. Replaying it would step the history of
    // the level the developer left, and the answer would be refused as
    // foreign, so nothing would say it happened.
    if (this.state.file?.path !== path) return;
    await this.sendStep(path, direction, attempt + 1);
  }

  /**
   * The view this level was last edited from, or nothing remembered for it.
   *
   * A storage failure drops storage for the session instead of being reported.
   * The view holds no authored data and reaches no file, so the cost of a page
   * that cannot store it is a camera the editor forgets — and an editor that
   * refused to open a level over that would be the worse answer.
   */
  private readStoredView(path: string): EditorViewState | undefined {
    const storage = this.storage;
    if (!storage) return undefined;
    try {
      return parseView(storage.getItem(viewStorageKey(this.projectId, path)));
    } catch {
      this.storage = undefined;
      return undefined;
    }
  }

  private storeView(view: EditorViewState): void {
    const storage = this.storage;
    const path = this.state.file?.path;
    if (!storage || path === undefined) return;
    try {
      storage.setItem(
        viewStorageKey(this.projectId, path),
        serializeView(view),
      );
    } catch {
      this.storage = undefined;
    }
  }

  private rebasesOf(commandId: string): number | undefined {
    return this.state.pending.find(
      (entry) => entry.command.commandId === commandId,
    )?.rebases;
  }

  private drop(
    commandId: string,
    diagnostic: EditorDiagnostic,
    snapshot?: DraftSnapshot,
  ): void {
    this.dispatch({
      type: "command-dropped",
      commandId,
      diagnostic,
      ...(snapshot === undefined ? {} : { snapshot }),
    });
  }

  private report(diagnostic: EditorDiagnostic): void {
    this.dispatch({
      type: "diagnostics-replaced",
      source: diagnostic.source,
      diagnostics: [diagnostic],
    });
  }
}

function dropDiagnostic(
  command: DocumentCommand,
  revision: number,
): EditorDiagnostic {
  const ids = placementIdsOf(command).join(", ");
  return {
    code: "command-dropped",
    severity: "error",
    source: "validation",
    message:
      `An edit to ${ids} was rebased ${MAX_REBASES} times and could not be ` +
      `applied. Reopen the level to continue editing.`,
    revision,
  };
}

/** The placements an edit was about, so a message can name what was lost. */
function placementIdsOf(command: DocumentCommand): readonly string[] {
  switch (command.kind) {
    case "set-poses":
      return command.poses.map((pose) => pose.id);
    case "add-placements":
      return command.inserts.map((insert) => insert.placement.id);
    case "remove-placements":
      return command.ids;
    case "set-values":
      return [...new Set(command.edits.map((edit) => edit.placementId))];
    case "move-placements":
      return command.moves.map((move) => move.id);
  }
}

/** The pending commands replayed on a committed document, in order. */
function project(
  document: LevelDocument,
  pending: readonly PendingCommand[],
): { document: LevelDocument; kept: readonly PendingCommand[] } {
  let next = document;
  const kept: PendingCommand[] = [];
  for (const entry of pending) {
    try {
      next = reduceCommand(next, entry.command).document;
      kept.push(entry);
    } catch (error) {
      // A command the newer draft made impossible — the placement it moves is
      // gone. Dropping it here is what keeps the projection a real document.
      if (!(error instanceof CommandPreconditionError)) throw error;
    }
  }
  return { document: next, kept };
}

/**
 * Adopt a snapshot as the committed state, unless it is older than what is
 * already committed. Two writes in flight can answer out of order, and an
 * older snapshot would undo edits the browser has already been told about.
 */
function adopt(
  state: EditorState,
  snapshot: DraftSnapshot,
  pending: readonly PendingCommand[],
): EditorState {
  if (!describesOpenLevel(state, snapshot)) return state;
  if (snapshot.draftRevision < state.committed.draftRevision) {
    const replayed = project(state.committed.document, pending);
    return { ...state, pending: replayed.kept, document: replayed.document };
  }
  const replayed = project(snapshot.document, pending);
  return {
    ...state,
    file: fileStateOf(snapshot),
    committed: {
      document: snapshot.document,
      draftRevision: snapshot.draftRevision,
    },
    pending: replayed.kept,
    document: replayed.document,
    selection: retainIds(state.selection, replayed.document),
    hidden: retainIds(state.hidden, replayed.document),
    pick: retainPick(state.pick, replayed.document),
    history: snapshot.history,
  };
}

/**
 * Whether a server answer is about the level on screen.
 *
 * `openLevel` settles before it switches, so the commands and history steps in
 * flight when it was called are answered first. A save is not in that barrier,
 * and a step issued while the switch is still reading is answered after it.
 * Such an answer carries the old level's path, hashes and revision, and
 * adopting it would leave the file bar naming one level while the document
 * holds another, and the next save addressing the wrong file.
 */
function describesOpenLevel(
  state: EditorState,
  snapshot: DraftSnapshot,
): boolean {
  return state.file !== undefined && snapshot.path === state.file.path;
}

function fileStateOf(snapshot: DraftSnapshot): EditorFileState {
  return {
    path: snapshot.path,
    ...(snapshot.layerSet === undefined ? {} : { layerSet: snapshot.layerSet }),
    diskRevision: snapshot.diskRevision,
    contentHash: snapshot.contentHash,
    savedContentHash: snapshot.savedContentHash,
  };
}

/**
 * A set of placements follows the document: an id the document no longer has
 * drops out of it. The selection and the hidden set both name placements and
 * both outlive an edit that removes one.
 */
function retainIds(
  named: ReadonlySet<string>,
  document: LevelDocument,
): ReadonlySet<string> {
  const ids = new Set(document.entities.map((placement) => placement.id));
  const kept = [...named].filter((id) => ids.has(id));
  return kept.length === named.size ? named : new Set(kept);
}

/** A pick follows the document: a holder it no longer has stops waiting. */
function retainPick(
  pick: ReferencePick | undefined,
  document: LevelDocument,
): ReferencePick | undefined {
  if (!pick) return undefined;
  return document.entities.some((one) => one.id === pick.placementId)
    ? pick
    : undefined;
}

/**
 * One diagnostic replaces every diagnostic from the same source, which is the
 * rule that keeps a fixed problem from staying on screen next to a current
 * one.
 */
function withDiagnostic(
  state: EditorState,
  diagnostic: EditorDiagnostic,
): ReadonlyMap<DiagnosticSource, readonly EditorDiagnostic[]> {
  const next = new Map(state.diagnostics);
  next.set(diagnostic.source, [diagnostic]);
  return next;
}

/** The diagnostics that outlive a level: the project's, and nothing else. */
function projectDiagnostics(
  diagnostics: ReadonlyMap<DiagnosticSource, readonly EditorDiagnostic[]>,
): ReadonlyMap<DiagnosticSource, readonly EditorDiagnostic[]> {
  const kept = diagnostics.get("catalog");
  return kept === undefined ? new Map() : new Map([["catalog", kept]]);
}

/**
 * The state with no level in it: what closing one leaves, and what opening one
 * puts a document, a file and a history back into.
 *
 * Everything a level owns is cleared here rather than at each call site, so the
 * transition is total. A drag and a marquee hold ids from the document being
 * left — a leaked gesture makes `isDirty` true for a level nobody has touched,
 * and a leaked marquee makes `Viewport`'s second-contact guard refuse every
 * press. A pending number, a parameter drag, a delete question and a waiting
 * pick each name a placement that is not in the next level either. Hiding is
 * this session's view of one level, and carrying it across would hide whatever
 * the next level happened to name an id the same way. Of the diagnostics only
 * `catalog` describes the project rather than the level, and it is still true.
 */
function withoutLevel(state: EditorState): EditorState {
  return {
    ...state,
    file: undefined,
    committed: { document: EMPTY_LEVEL_DOCUMENT, draftRevision: 0 },
    pending: [],
    document: EMPTY_LEVEL_DOCUMENT,
    selection: new Set(),
    hidden: new Set(),
    history: NO_HISTORY,
    gesture: undefined,
    marquee: undefined,
    poseDraft: undefined,
    paramDrag: undefined,
    pendingDelete: undefined,
    pick: undefined,
    diagnostics: projectDiagnostics(state.diagnostics),
  };
}

function reduce(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "level-opened": {
      const snapshot = action.snapshot;
      return {
        ...withoutLevel(state),
        file: fileStateOf(snapshot),
        committed: {
          document: snapshot.document,
          draftRevision: snapshot.draftRevision,
        },
        document: snapshot.document,
        history: snapshot.history,
      };
    }
    case "level-closed":
      // No level to put in the empty state's place: the one that was open is
      // gone from disk.
      return withoutLevel(state);
    case "level-added": {
      // In path order, which is the order the server lists them in and the
      // order the picker shows.
      const levels = [...state.levels, action.level].sort((one, other) =>
        one.path < other.path ? -1 : one.path > other.path ? 1 : 0,
      );
      return { ...state, levels };
    }
    case "levels-replaced": {
      return { ...state, levels: action.levels };
    }
    case "command-applied": {
      const pending = [
        ...state.pending,
        { command: action.command, rebases: 0 },
      ];
      const replayed = project(state.committed.document, pending);
      return { ...state, pending: replayed.kept, document: replayed.document };
    }
    case "command-accepted": {
      const pending = state.pending.filter(
        (entry) => entry.command.commandId !== action.commandId,
      );
      return adopt(state, action.snapshot, pending);
    }
    case "command-rebased": {
      const pending = state.pending.map((entry) =>
        entry.command.commandId === action.commandId
          ? { command: entry.command, rebases: entry.rebases + 1 }
          : entry,
      );
      return adopt(state, action.snapshot, pending);
    }
    case "command-dropped": {
      const pending = state.pending.filter(
        (entry) => entry.command.commandId !== action.commandId,
      );
      const replayed = project(state.committed.document, pending);
      const next = action.snapshot
        ? adopt(state, action.snapshot, pending)
        : { ...state, pending: replayed.kept, document: replayed.document };
      return { ...next, diagnostics: withDiagnostic(next, action.diagnostic) };
    }
    case "history-stepped": {
      // The pending list is carried through: a command sent while the step was
      // in flight is still the browser's, and the replay it lost to is now
      // part of the committed document it replays on.
      return adopt(state, action.snapshot, state.pending);
    }
    case "saved": {
      if (!describesOpenLevel(state, action.snapshot)) return state;
      return {
        ...state,
        file: fileStateOf(action.snapshot),
        history: action.snapshot.history,
      };
    }
    case "selection-changed": {
      const selection = new Set(action.ids);
      // A pending number belongs to the panel that was showing it, and the
      // inspector shows that panel for exactly one selected placement. Any
      // other selection takes the panel away, so the number is dropped rather
      // than written — the rule the asset field already keeps for a half-typed
      // path.
      const poseDraft =
        state.poseDraft &&
        action.ids.length === 1 &&
        action.ids[0] === state.poseDraft.id
          ? state.poseDraft
          : undefined;
      // A waiting reference field is shown by that same panel, so it is left
      // for exactly the same reason and by exactly the same rule.
      const pick =
        state.pick &&
        action.ids.length === 1 &&
        action.ids[0] === state.pick.placementId
          ? state.pick
          : undefined;
      return { ...state, selection, poseDraft, pick };
    }
    case "hidden-toggled": {
      if (action.ids.length === 0) return state;
      const hidden = new Set(state.hidden);
      for (const id of action.ids) {
        if (!hidden.delete(id)) hidden.add(id);
      }
      return { ...state, hidden };
    }
    case "hidden-set": {
      return { ...state, hidden: new Set(action.ids) };
    }
    case "hidden-cleared": {
      return state.hidden.size === 0 ? state : { ...state, hidden: new Set() };
    }
    case "placements-copied": {
      return { ...state, clipboard: action.placements };
    }
    case "tool-changed": {
      return state.tool === action.tool
        ? state
        : { ...state, tool: action.tool };
    }
    case "pivot-changed": {
      return state.pivot === action.pivot
        ? state
        : { ...state, pivot: action.pivot };
    }
    case "axes-changed": {
      return state.axes === action.axes
        ? state
        : { ...state, axes: action.axes };
    }
    case "view-panned": {
      return { ...state, view: pannedView(state.view, action.by) };
    }
    case "view-zoomed": {
      return {
        ...state,
        view: zoomedViewAt(state.view, action.factor, action.anchor),
      };
    }
    case "view-changed": {
      return { ...state, view: normalizedView(action.view) };
    }
    case "guides-toggled": {
      return { ...state, view: toggledGuides(state.view) };
    }
    case "snap-toggled": {
      return { ...state, view: toggledSnap(state.view) };
    }
    case "step-changed": {
      return { ...state, view: withStep(state.view, action.step) };
    }
    case "viewport-measured": {
      return { ...state, viewport: action.viewport };
    }
    case "gesture-started": {
      return { ...state, gesture: action.gesture };
    }
    case "gesture-moved": {
      if (!state.gesture) return state;
      return {
        ...state,
        gesture: {
          ...state.gesture,
          current: action.current,
          spin: action.spin,
          constrained: action.constrained,
          suspended: action.suspended,
        },
      };
    }
    case "marquee-started": {
      return { ...state, marquee: action.marquee };
    }
    case "marquee-moved": {
      if (!state.marquee) return state;
      return {
        ...state,
        marquee: {
          ...state.marquee,
          to: action.to,
          additive: action.additive,
        },
      };
    }
    case "marquee-ended": {
      if (!state.marquee) return state;
      return { ...state, marquee: undefined };
    }
    case "gesture-ended": {
      if (!state.gesture) return state;
      return { ...state, gesture: undefined };
    }
    case "pose-drafted": {
      return { ...state, poseDraft: action.draft };
    }
    case "pose-draft-dropped": {
      if (!state.poseDraft) return state;
      return { ...state, poseDraft: undefined };
    }
    case "param-drag-started": {
      return { ...state, paramDrag: action.drag };
    }
    case "param-drag-moved": {
      if (!state.paramDrag) return state;
      return {
        ...state,
        paramDrag: {
          ...state.paramDrag,
          current: action.current,
          constrained: action.constrained,
          suspended: action.suspended,
        },
      };
    }
    case "param-drag-ended": {
      if (!state.paramDrag) return state;
      return { ...state, paramDrag: undefined };
    }
    case "delete-confirm-requested": {
      return { ...state, pendingDelete: action.ids };
    }
    case "delete-confirm-dismissed": {
      if (!state.pendingDelete) return state;
      return { ...state, pendingDelete: undefined };
    }
    case "pick-started": {
      return { ...state, pick: action.pick };
    }
    case "pick-ended": {
      if (!state.pick) return state;
      return { ...state, pick: undefined };
    }
    case "diagnostics-replaced": {
      const diagnostics = new Map(state.diagnostics);
      diagnostics.set(action.source, action.diagnostics);
      return { ...state, diagnostics };
    }
    case "writes-locked": {
      if (state.writesLocked.includes(action.reason)) return state;
      return {
        ...state,
        writesLocked: [...state.writesLocked, action.reason],
      };
    }
  }
}

/** Whether an action is one the view is written back to storage after. */
function isViewAction(action: EditorAction): boolean {
  return (
    action.type === "view-panned" ||
    action.type === "view-zoomed" ||
    action.type === "view-changed" ||
    action.type === "guides-toggled" ||
    action.type === "snap-toggled" ||
    action.type === "step-changed"
  );
}

/**
 * Whether the level on screen accepts edits: one is open, and no module has
 * locked writes.
 */
export function isEditable(state: EditorState): boolean {
  return state.file !== undefined && state.writesLocked.length === 0;
}

/** True when the committed draft differs from what is on disk, or work is unsent. */
export function isDirty(state: EditorState): boolean {
  if (!state.file) return false;
  if (
    state.pending.length > 0 ||
    state.gesture !== undefined ||
    state.poseDraft !== undefined ||
    state.paramDrag !== undefined
  ) {
    return true;
  }
  return state.file.contentHash !== state.file.savedContentHash;
}

/** The named placements' current poses, for a consumer that mirrors the document. */
export function posesOf(
  state: EditorState,
  ids: readonly string[],
): readonly PoseEdit[] {
  const wanted = new Set(ids);
  return state.document.entities
    .filter((placement) => wanted.has(placement.id))
    .map((placement) => ({ id: placement.id, transform: placement.transform }));
}
