import type { EditorDiagnostic } from "../../shared/diagnostics/index.js";
import type { LevelCreateOutcome } from "../../shared/protocol/index.js";
import { EditorApiError, type EditorApiClient } from "../api/index.js";
import type { CommandController } from "../commands/index.js";
import { isDirty, type EditorStore } from "../store/index.js";

export interface FileCoordinatorOptions {
  readonly api: EditorApiClient;
  readonly store: EditorStore;
  readonly commands: CommandController;
  /** The server boot this browser is paired with; every write carries it. */
  readonly epoch: string;
  /** The project's game page URL, when its config named one. */
  readonly gamePage?: string | undefined;
  /** Where a run opens. Defaults to a new browser tab; injected by tests. */
  readonly openRun?: ((url: string) => void) | undefined;
}

/**
 * What a run URL calls the level.
 *
 * The whole protocol between the editor and a game: one parameter naming a
 * file the game fetches for itself. A game with a single level can ignore it.
 * It is documented rather than exported, because a game depends on
 * `@yagejs/level` and never on this package.
 */
export const RUN_LEVEL_PARAM = "level";

/** Stands in for the page's own location while a URL is assembled. */
const RUN_BASE = "http://editor.invalid/";

/**
 * What an answer looks like when the server changed nothing: a draft route
 * calls it rejected and a level-file route calls it refused, and both carry
 * the message the shell shows.
 */
interface Refused {
  readonly status: "rejected" | "refused";
  readonly message: string;
}

function isRefused(outcome: { readonly status: string }): outcome is Refused {
  return outcome.status === "rejected" || outcome.status === "refused";
}

/**
 * The editor's play page, relative to the editor page so it resolves under
 * whatever base the project configured.
 *
 * Named as a file rather than as `play`: a level's asset paths are relative,
 * and an extensionless URL reads as a directory when they are resolved, which
 * would send every asset request one level too deep.
 */
const PLAY_PAGE = "play.html";

/**
 * Owns the browser's side of server file state: opening a level, promoting a
 * draft to disk, and running one.
 *
 * Nothing here returns a value to its caller. Open and save report through the
 * store, so the shell reads one place for what happened rather than two; run
 * navigates instead, because opening a tab is not document state and an action
 * the shell must react to exactly once fires twice under React's development
 * double-render.
 */
export class FileCoordinator {
  private readonly api: EditorApiClient;
  private readonly store: EditorStore;
  private readonly commands: CommandController;
  private readonly epoch: string;
  private readonly gamePage: string | undefined;
  private readonly openRun: (url: string) => void;
  /** True between sending a save and hearing back. */
  private saving = false;
  /** Which open is current. An answer from an older one is discarded. */
  private opening = 0;

  constructor(options: FileCoordinatorOptions) {
    this.api = options.api;
    this.store = options.store;
    this.commands = options.commands;
    this.epoch = options.epoch;
    this.gamePage = options.gamePage;
    this.openRun =
      options.openRun ??
      ((url) => {
        window.open(url, "_blank", "noopener");
      });
  }

  /**
   * Read one level's draft in a single server step, so the document, both
   * hashes, and the revision in the store describe one moment.
   *
   * Settling first is the rule save and run follow, and here it also decides
   * where an edit lands: a command re-sent after a `stale` answer carries the
   * path it started with and the revision the store holds now, so an edit that
   * outlived a switch would address the level the developer left. Waiting the
   * barrier out lands the edits in flight in the level they were made in.
   *
   * The level being left keeps its draft, its undo history and its
   * saved-versus-current hashes: the server holds one per path for as long as
   * it runs, and deletes none.
   */
  async openLevel(path: string): Promise<void> {
    // A refusal here is no file at that path, or one that does not parse. The
    // editor stays open on whatever it already had and says why this level did
    // not.
    const outcome = await this.exchange(
      () => this.api.fetchSnapshot(path),
      `Could not open ${path}.`,
    );
    if (!outcome) return;
    this.store.dispatch({ type: "level-opened", snapshot: outcome.snapshot });
  }

  /**
   * Write a level holding nothing and open it.
   *
   * The response carries the new level's summary and its draft, so the picker
   * lists it and the editor opens it with no second round trip. The server
   * decides whether the path is one this project's globs cover and whether a
   * file already holds it; a refusal is reported and nothing changes.
   */
  async createLevel(path: string, levelId: string): Promise<void> {
    await this.opened(path, () =>
      this.api.createLevel(path, { epoch: this.epoch, levelId }),
    );
  }

  /** The same, from a copy of another level rather than from nothing. */
  async duplicateLevel(
    sourcePath: string,
    path: string,
    levelId: string,
  ): Promise<void> {
    await this.opened(path, () =>
      this.api.duplicateLevel(path, { epoch: this.epoch, levelId, sourcePath }),
    );
  }

  /**
   * Remove a level file, and land somewhere sensible if it was the open one.
   *
   * The level that takes its place in the list opens; when it was the last
   * level, nothing is open and the shell says so. The draft goes with the
   * file, so its unsaved work and its undo history are gone — this is not a
   * document command and undo does not bring a file back.
   */
  async deleteLevel(path: string): Promise<void> {
    // Where the deleted level sat, so the one that takes its place is the one
    // that opens. Read before the answer replaces the list.
    const at = this.store
      .getState()
      .levels.findIndex((one) => one.path === path);
    const outcome = await this.exchange(
      () => this.api.deleteLevel(path, { epoch: this.epoch }),
      `Could not delete ${path}.`,
    );
    if (!outcome) return;
    this.store.dispatch({ type: "levels-replaced", levels: outcome.levels });
    if (this.store.getState().file?.path !== path) return;
    const next = outcome.levels[Math.min(at, outcome.levels.length - 1)];
    if (next) await this.openLevel(next.path);
    else this.store.dispatch({ type: "level-closed" });
  }

  /** Send a request that writes a level file, and open what it wrote. */
  private async opened(
    path: string,
    send: () => Promise<LevelCreateOutcome>,
  ): Promise<void> {
    const outcome = await this.exchange(send, `Could not create ${path}.`);
    if (!outcome) return;
    // The list first: the picker's value is the open level's path, and a value
    // its options do not carry shows as nothing chosen.
    this.store.dispatch({ type: "level-added", level: outcome.level });
    this.store.dispatch({ type: "level-opened", snapshot: outcome.snapshot });
  }

  /**
   * Send one request about which level is open, and hand back the answer worth
   * acting on.
   *
   * The edits in flight are settled first, so they land in the level being
   * left rather than addressing it from the level being entered.
   *
   * Undefined means the caller has nothing to do. A refusal and a request that
   * never arrived are both reported as a file diagnostic, which is where the
   * shell reads them; an answer a later request has overtaken is dropped in
   * silence, because that request is already deciding what is open.
   */
  private async exchange<T extends { readonly status: string }>(
    send: () => Promise<T>,
    failureMessage: string,
  ): Promise<Exclude<T, Refused> | undefined> {
    this.opening += 1;
    const attempt = this.opening;
    await this.commands.settleEdits();
    if (attempt !== this.opening) return undefined;
    let outcome: T;
    try {
      outcome = await send();
    } catch (error) {
      if (attempt !== this.opening) return undefined;
      this.report(error, failureMessage);
      return undefined;
    }
    if (attempt !== this.opening) return undefined;
    if (isRefused(outcome)) {
      this.fail(outcome.message, this.store.getState().committed.draftRevision);
      return undefined;
    }
    return outcome as Exclude<T, Refused>;
  }

  /**
   * Open the level the editor starts on, unless a level has already been
   * asked for.
   *
   * The shell renders before the preview is ready, so the picker is live and
   * enabled while the engine boots. A pick made in that window is a deliberate
   * choice and starts its own open; opening the default over it would revert
   * the developer's action with nothing said.
   */
  async openInitialLevel(path: string): Promise<void> {
    if (this.opening !== 0) return;
    await this.openLevel(path);
  }

  /**
   * Write the draft to disk.
   *
   * The request names a revision and carries no document: the server writes
   * the draft it already holds at that revision. Settling first is what makes
   * that revision the one the user can see — an open drag and a command still
   * in flight are both edits it would otherwise leave out.
   */
  async save(): Promise<void> {
    // A second save while one is in flight would address the disk revision the
    // first is about to replace, and the server would refuse it as a change
    // made outside the editor — which is not what happened.
    if (this.saving) return;
    // Claimed before the first await: settling yields, and a second click
    // during that window would otherwise get all the way through.
    this.saving = true;
    try {
      await this.commands.settleEdits();
      // A dropped command locks writes, so the lock is what refuses the save
      // rather than a status this method has to interpret.
      if (!this.store.writable) return;
      const state = this.store.getState();
      const file = state.file;
      if (!file) return;

      const outcome = await this.api.save(file.path, {
        epoch: this.epoch,
        expectedDraftRevision: state.committed.draftRevision,
        expectedDiskRevision: file.diskRevision,
      });
      if (outcome.status === "accepted") {
        this.store.dispatch({ type: "saved", snapshot: outcome.snapshot });
        return;
      }
      // `stale` never comes back from this route — the draft service answers a
      // save with accepted or rejected — but the union carries it, and a
      // message describing a state that cannot occur is worse than this one.
      const message =
        outcome.status === "rejected"
          ? outcome.message
          : "The save was refused. Reopen the level and try again.";
      this.fail(message, state.committed.draftRevision);
    } catch (error) {
      this.report(error, "The save request did not reach the editor server.");
    } finally {
      this.saving = false;
    }
  }

  /**
   * Save, then open the game page on the level that was written.
   *
   * Settling first is the same rule save follows: an open drag and a command
   * still in flight are both edits the save would otherwise leave out. The URL
   * names the level's path and nothing else, so the game reads the file it
   * would read anyway and speaks no editor protocol.
   *
   * A project that named no game page has no Run control, so this is not
   * reachable without one.
   *
   * The URL it opens is relative, so the browser resolves it against this
   * page — which the dev server serves at the project's Vite base. A
   * root-absolute URL would address the server root instead, and under a base
   * every project page lives below it.
   */
  async run(): Promise<void> {
    if (this.gamePage === undefined) return;
    // Which level this was pressed on. Settling and saving are round trips,
    // and a level picked inside them would otherwise decide what the game
    // opens — a level this run never wrote.
    const pressedOn = this.store.getState().file?.path;
    await this.commands.settleEdits();
    if (!this.store.writable) return;
    // `save()` reads the open level for itself, so a switch that completed
    // while the barrier was waiting has to stop the run before the write
    // rather than after it: saving a level nobody pressed Save on is a
    // surprise the later check cannot take back.
    if (this.store.getState().file?.path !== pressedOn) return;
    // The game reads the file, so the file has to be what the editor is
    // showing. Play is what runs an unsaved draft; Run answers the one
    // question Play cannot, which is whether the real game loads what was
    // written. A save that fails leaves the draft dirty, and running the old
    // file then would show something nobody asked for.
    if (isDirty(this.store.getState())) await this.save();
    const file = this.store.getState().file;
    if (!file || file.path !== pressedOn) return;
    if (isDirty(this.store.getState())) return;

    const url = new URL(this.gamePage, RUN_BASE);
    url.searchParams.set(RUN_LEVEL_PARAM, file.path);
    this.openRun(`${url.pathname.slice(1)}${url.search}${url.hash}`);
  }

  /**
   * Open the play page on the level being edited.
   *
   * It runs the draft, so nothing is written and an unsaved level plays as it
   * stands. The page is the editor's own, which is why this needs no game page
   * and works on a project that has never named one.
   */
  async play(): Promise<void> {
    // The level this was pressed on, for the reason `run` captures it.
    const pressedOn = this.store.getState().file?.path;
    await this.commands.settleEdits();
    const file = this.store.getState().file;
    if (!file || file.path !== pressedOn) return;
    const url = new URL(PLAY_PAGE, RUN_BASE);
    url.searchParams.set(RUN_LEVEL_PARAM, file.path);
    this.openRun(`${url.pathname.slice(1)}${url.search}${url.hash}`);
  }

  /** Whether the project named a game page, which is what Run needs. */
  get runnable(): boolean {
    return this.gamePage !== undefined;
  }

  private report(error: unknown, message: string): void {
    if (!(error instanceof EditorApiError)) throw error;
    this.fail(message, this.store.getState().committed.draftRevision);
  }

  private fail(message: string, revision: number): void {
    const diagnostic: EditorDiagnostic = {
      code: "server-rejected",
      severity: "error",
      source: "file",
      message,
      revision,
    };
    this.store.dispatch({
      type: "diagnostics-replaced",
      source: "file",
      diagnostics: [diagnostic],
    });
  }
}
