import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { LevelSummary } from "../../shared/protocol/index.js";
import { Button, Select } from "./controls.js";

/** What a level file is named on disk, after the name the dialog asks for. */
const LEVEL_SUFFIX = ".yage-level.json";

/** What the file bar has opened, and what the dialog does when it is answered. */
export type LevelRequest =
  /** Write a level holding nothing. */
  | { readonly kind: "new" }
  /** Copy this level under a new name. */
  | { readonly kind: "duplicate"; readonly source: string }
  /** Remove this level, once the question below it is answered. */
  | { readonly kind: "delete"; readonly path: string };

/**
 * The path a name lands on: the chosen directory, the name, and the suffix
 * every level file carries.
 */
export function levelPathFor(directory: string, name: string): string {
  const file = `${name}${LEVEL_SUFFIX}`;
  return directory === "" ? file : `${directory}/${file}`;
}

/** The part of a level's path a name is read back out of. */
function nameOf(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return file.endsWith(LEVEL_SUFFIX)
    ? file.slice(0, -LEVEL_SUFFIX.length)
    : file;
}

/** The directory a level sits in, `""` for one at the project root. */
function directoryOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export interface NewLevelDialogProps {
  readonly request: Extract<LevelRequest, { kind: "new" | "duplicate" }>;
  /** Where a new level can go, as the server reported them. */
  readonly directories: readonly string[];
  /** Every level there is, which is how a name already taken is caught here. */
  readonly levels: readonly LevelSummary[];
  /** Whether the level being copied has work nothing has written. */
  readonly dirty: boolean;
  /** Why the server refused what was submitted, once it has answered. */
  readonly reason?: string | undefined;
  readonly onSubmit: (path: string, levelId: string) => void;
  readonly onCancel: () => void;
}

/**
 * What New and Duplicate both ask for: a name, and the path it lands on.
 *
 * The name is the level's id, which is what the document holds and the game
 * reads. The path follows the name while nobody has typed one, so the usual
 * answer is one word; a project with more than one configured level directory
 * chooses between them, and the path itself can be typed over for anything
 * else. The server is still the judge — it refuses a path its globs do not
 * cover, and one a file already holds.
 */
export function NewLevelDialog(props: NewLevelDialogProps): React.JSX.Element {
  const duplicating =
    props.request.kind === "duplicate" ? props.request.source : undefined;
  const [name, setName] = useState(
    duplicating === undefined ? "" : `${nameOf(duplicating)}-copy`,
  );
  const [directory, setDirectory] = useState(() =>
    startingDirectory(props.directories, duplicating),
  );
  // The path once it has been typed over. While it is unset the name and the
  // directory decide it, so a developer who types only a name never sees a
  // path that stopped following.
  const [typed, setTyped] = useState<string | undefined>();
  const path = typed ?? levelPathFor(directory, name.trim());
  const taken = props.levels.some((level) => level.path === path);
  const ready = name.trim() !== "" && path !== "" && !taken;
  const submit = (): void => {
    if (ready) props.onSubmit(path, name.trim());
  };
  /** Enter answers the dialog, from either box. */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  };

  return (
    <div
      className="ye-confirm ye-confirm--ask"
      role="dialog"
      aria-label={duplicating === undefined ? "New level" : "Duplicate level"}
      data-testid="level-dialog"
      // Escape leaves the dialog from anywhere inside it, the folder chooser
      // included.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        props.onCancel();
      }}
    >
      <p>
        {duplicating === undefined
          ? "A new level, with nothing in it."
          : `A copy of ${duplicating}.`}
      </p>
      {duplicating !== undefined && props.dirty ? (
        <p data-testid="level-copies-file">
          A copy of the file on disk; your unsaved edits are not in it.
        </p>
      ) : null}
      <label className="ye-field">
        <span className="ye-field__label">Name</span>
        <input
          type="text"
          data-testid="level-name"
          autoFocus
          value={name}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setName(event.currentTarget.value);
          }}
        />
      </label>
      {props.directories.length > 1 ? (
        <label className="ye-field">
          <span className="ye-field__label">Folder</span>
          <Select
            label="Which folder the level goes in"
            testId="level-directory"
            value={directory}
            options={props.directories.map((entry) => ({
              value: entry,
              label: entry === "" ? "(project root)" : entry,
            }))}
            onChange={(next) => {
              setDirectory(next);
              // The path follows the folder for the same reason it follows the
              // name — unless it has been typed, which outranks both.
              setTyped(undefined);
            }}
          />
        </label>
      ) : null}
      <label className="ye-field">
        <span className="ye-field__label">Path</span>
        <input
          type="text"
          data-testid="level-path"
          value={path}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setTyped(event.currentTarget.value);
          }}
        />
      </label>
      {taken ? (
        <p className="ye-field__reason" data-testid="level-path-taken">
          {path} already exists.
        </p>
      ) : null}
      {props.reason === undefined ? null : (
        <p className="ye-field__reason" data-testid="level-dialog-reason">
          {props.reason}
        </p>
      )}
      <div className="ye-confirm__actions">
        <Button testId="create-level" disabled={!ready} onClick={submit}>
          {duplicating === undefined ? "Create" : "Duplicate"}
        </Button>
        <Button testId="cancel-level" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Which folder a dialog starts on: the one the level being copied sits in when
 * that is somewhere a level may go, and otherwise the first on offer.
 */
function startingDirectory(
  directories: readonly string[],
  source: string | undefined,
): string {
  if (source !== undefined) {
    const beside = directoryOf(source);
    if (directories.includes(beside)) return beside;
  }
  return directories[0] ?? "";
}

export interface DeleteLevelConfirmProps {
  readonly path: string;
  /** Whether this is the open level and it has work nothing has written. */
  readonly dirty: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * The question a delete asks.
 *
 * It names unsaved work, because deleting the file drops the draft with it and
 * no undo brings either back — this is a file, not an edit to a document.
 */
export function DeleteLevelConfirm(
  props: DeleteLevelConfirmProps,
): React.JSX.Element {
  return (
    <div
      className="ye-confirm"
      role="alertdialog"
      data-testid="delete-level-confirm"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        props.onCancel();
      }}
    >
      <p>
        Delete {props.path}? The file goes, and so does its undo history.
        {props.dirty ? " It has unsaved work, which goes with it." : ""}
      </p>
      <div className="ye-confirm__actions">
        <Button testId="confirm-delete-level" onClick={props.onConfirm}>
          Delete level
        </Button>
        {/* Cancel takes the focus, so the key that answers a question nobody
            meant to ask is the one that leaves it alone. */}
        <Button testId="cancel-delete-level" autoFocus onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
