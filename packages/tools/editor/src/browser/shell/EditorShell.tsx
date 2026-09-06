import { useEffect, useState } from "react";
import type { AssetListing } from "../../shared/protocol/index.js";
import {
  inboundReferences,
  rootsWithout,
  selectionRoots,
  sharedParent,
} from "../commands/index.js";
import type { CommandController } from "../commands/index.js";
import type { LayerChoice } from "../layers.js";
import type { InspectableType, PlaceableType } from "../project/index.js";
import {
  isDirty,
  isEditable,
  resetView,
  type EditorStore,
} from "../store/index.js";
import { ControlBar } from "./ControlBar.js";
import { Hierarchy } from "./Hierarchy.js";
import { Inspector } from "./Inspector.js";
import { Actors } from "./Actors.js";
import { Problems } from "./Problems.js";
import { Button, Select } from "./controls.js";
import {
  DeleteLevelConfirm,
  NewLevelDialog,
  type LevelRequest,
} from "./LevelDialogs.js";
import { selectedAfter } from "./selection.js";
import { EDITOR_CSS } from "./styles.js";
import { GUIDES_KEY, HIDE_KEY, SNAP_KEY, TOOLS, Toolbar } from "./Toolbar.js";
import { useEditorSlice } from "./useEditorSlice.js";
import { useShortcuts } from "./useShortcuts.js";
import { Viewport, type ViewportPreview } from "./Viewport.js";

/**
 * What the shell needs from the preview: what the viewport needs, plus the one
 * call a shortcut makes.
 */
export interface ShellPreview extends ViewportPreview {
  /** Move the view onto the named placements. */
  frameSelection(ids: readonly string[]): void;
}

/** What the toolbar's file controls call. */
export interface ShellFiles {
  /**
   * Open another level. It settles the open edits into the level being left,
   * whose draft the server keeps.
   */
  openLevel(path: string): Promise<void>;
  save(): Promise<void>;
  /** Write a level holding nothing at `path`, under this level id, and open it. */
  createLevel(path: string, levelId: string): Promise<void>;
  /** The same, from a copy of `sourcePath`. */
  duplicateLevel(
    sourcePath: string,
    path: string,
    levelId: string,
  ): Promise<void>;
  /** Remove a level file, and open what is left in its place. */
  deleteLevel(path: string): Promise<void>;
  run(): Promise<void>;
  /** Open the level running in the editor's own page. Needs no game page. */
  play(): Promise<void>;
  /** False when the project named no game page, and Run is not rendered. */
  readonly runnable: boolean;
}

export interface EditorShellProps {
  readonly store: EditorStore;
  readonly commands: CommandController;
  readonly files: ShellFiles;
  readonly preview: ShellPreview;
  readonly canvasHost: HTMLElement;
  /**
   * What the Actors panel lists, read on each render rather than passed as a
   * value: the shell mounts before the project's modules are evaluated, and
   * the first render after a level opens is the first one that can place
   * anything.
   */
  readonly placeables: () => readonly PlaceableType[];
  /** What the inspector renders for a type, read the same way. */
  readonly inspectable: (typeId: string) => InspectableType | undefined;
  /**
   * Every project asset, read fresh each time the asset field's list opens. A
   * failure throws `EditorApiError`, which the field reports beside itself.
   */
  readonly listAssets: () => Promise<AssetListing>;
  /**
   * Where a new level can go, as the server read it off the config's globs.
   * The New dialog offers these, and puts the level in the first one.
   */
  readonly levelDirectories: readonly string[];
  /**
   * The layers the open level may put a placement on, read on each render.
   * Empty when the project declared none for it, which is when the inspector
   * shows no layer control at all.
   */
  readonly layerChoices: () => readonly LayerChoice[];
  /**
   * Whether the layer a placement draws on keys its own draw order. The
   * ordering controls say so instead of reordering a document to no effect.
   */
  readonly layerSorts: (layer: string | undefined) => boolean;
}

/**
 * The editor's window: what file is open, whether it has unsaved work, the
 * viewport, and anything that went wrong.
 *
 * It renders from store state alone and sends every intent through the
 * controller or a coordinator, so no component can change a document or touch
 * the engine.
 *
 * The three bars split by what they act on. The first owns the file: which
 * level is open, whether it has unsaved work, and the two actions that leave
 * the editor. The second owns the level: which gizmo is live, and the three
 * edit actions. The third owns the selected placement: its name and its pose.
 *
 * Below them the hierarchy is on the left, the viewport takes the rest, the
 * inspector is on the right, and Actors is a strip under the viewport that its
 * own header opens and closes, taking its height from the viewport rather than
 * covering it.
 *
 * Its picker lists the levels the store holds: what the server found when the
 * page loaded, plus what New and Duplicate have made since. A level file
 * written from outside the editor needs a reload before it can be chosen.
 */
export function EditorShell(props: EditorShellProps): React.JSX.Element {
  const store = props.store;
  // One slice per thing the file bar and the toolbar draw, rather than the
  // whole state. Each is a primitive or a field the reducer replaces only
  // when it changes, so a
  // drag — which moves `gesture` and nothing else — re-renders neither of
  // them, and with them neither panel below. The control bar is the one part
  // that follows a drag, and it subscribes for itself.
  const filePath = useEditorSlice(store, (state) => state.file?.path);
  const levels = useEditorSlice(store, (state) => state.levels);
  /** Which level file question is open: New, Duplicate, or a delete. */
  const [levelRequest, setLevelRequest] = useState<LevelRequest | undefined>();
  /**
   * The path a submitted New or Duplicate is waiting for the server to open.
   *
   * The dialog stays up until that level is the open one, so a refusal — a
   * path no glob covers, a file already there — is answered in front of the
   * name and the path that were typed rather than after they are gone.
   */
  const [awaiting, setAwaiting] = useState<string | undefined>();
  // What this dialog's own request produced: submitting clears the source
  // first, so anything under it now is the answer to what was submitted.
  const fileProblem = useEditorSlice(
    store,
    (state) => state.diagnostics.get("file")?.[0]?.message,
  );
  useEffect(() => {
    if (awaiting !== undefined && filePath === awaiting) {
      setAwaiting(undefined);
      setLevelRequest(undefined);
    }
  }, [awaiting, filePath]);
  const writesLocked = useEditorSlice(store, (state) => state.writesLocked);
  const dirty = useEditorSlice(store, isDirty);
  const editable = useEditorSlice(store, isEditable);
  const hasSelection = useEditorSlice(
    store,
    (state) => state.selection.size > 0,
  );
  const anythingHidden = useEditorSlice(
    store,
    (state) => state.hidden.size > 0,
  );
  // How many placements an arrangement would act on: the selection's roots
  // when they all sit under one parent, and none when they do not. A count
  // rather than the ids, so this stays a primitive the store can bail out on.
  const arrangeable = useEditorSlice(store, (state) => {
    if (state.selection.size < 2) return 0;
    const roots = selectionRoots(state.document, state.selection);
    return sharedParent(state.document, roots) === undefined ? 0 : roots.length;
  });
  // The two depths rather than the `history` object: a snapshot carries a
  // fresh one per server answer, so the object changes when nothing has.
  const undoDepth = useEditorSlice(store, (state) => state.history.undoDepth);
  const redoDepth = useEditorSlice(store, (state) => state.history.redoDepth);
  const tool = useEditorSlice(store, (state) => state.tool);
  const pivot = useEditorSlice(store, (state) => state.pivot);
  const axes = useEditorSlice(store, (state) => state.axes);
  // Read once for the whole session, the same listing the picker uses. Actors
  // needs it to tell whether an atlas sits beside a type's texture, which is
  // what lets a thumbnail show one frame of a sheet rather than the strip.
  const [assetPaths, setAssetPaths] = useState<readonly string[]>([]);
  const listAssets = props.listAssets;
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const listing = await listAssets();
        if (live) setAssetPaths(listing.paths);
      } catch {
        // A thumbnail falls back to the image's own proportions, so a listing
        // that never arrives costs a crop and nothing else.
      }
    })();
    return () => {
      live = false;
    };
  }, [listAssets]);
  // The three parts of `view` the toolbar shows, not `view` itself, which a
  // pan replaces once per pointer move.
  const guides = useEditorSlice(store, (state) => state.view.guides);
  const snap = useEditorSlice(store, (state) => state.view.snap);
  const step = useEditorSlice(store, (state) => state.view.step);
  const locked = writesLocked.length > 0;

  // Every handler below reads the store when the key is pressed.
  // `useShortcuts` runs the callbacks from the last render, and the shell does
  // not render when the selection changes between two non-empty sets, or when
  // the view pans or zooms — so a closed-over selection or view would be the
  // one from whenever the shell last drew.
  useShortcuts([
    {
      key: "z",
      mod: true,
      run: () => {
        const state = store.getState();
        if (isEditable(state) && state.history.undoDepth > 0) {
          void props.commands.undo();
        }
      },
    },
    {
      key: "z",
      mod: true,
      shift: true,
      run: () => {
        const state = store.getState();
        if (isEditable(state) && state.history.redoDepth > 0) {
          void props.commands.redo();
        }
      },
    },
    {
      // The editor's only window-level Escape. `useShortcuts` leaves a
      // keystroke a text box owns to that box, so a field being typed into
      // keeps its own.
      key: "escape",
      run: () => {
        if (store.getState().pick) props.commands.cancelPick();
      },
    },
    {
      key: "f",
      run: () => {
        props.preview.frameSelection([...store.getState().selection]);
      },
    },
    {
      key: "f",
      shift: true,
      run: () => {
        const state = store.getState();
        store.dispatch({
          type: "view-changed",
          view: resetView(state.view, state.viewport),
        });
      },
    },
    {
      key: "c",
      mod: true,
      run: () => {
        // Copying is not an edit, so it works on a read-only level too.
        props.commands.copyPlacements([...store.getState().selection]);
      },
    },
    {
      key: "v",
      mod: true,
      run: () => {
        if (isEditable(store.getState())) props.commands.pastePlacements();
      },
    },
    {
      key: "d",
      mod: true,
      run: () => {
        const state = store.getState();
        if (isEditable(state)) {
          props.commands.duplicatePlacements([...state.selection]);
        }
      },
    },
    {
      key: GUIDES_KEY.toLowerCase(),
      run: () => {
        store.dispatch({ type: "guides-toggled" });
      },
    },
    {
      key: HIDE_KEY.toLowerCase(),
      run: () => {
        hideSelection(store);
      },
    },
    {
      key: HIDE_KEY.toLowerCase(),
      shift: true,
      run: () => {
        store.dispatch({ type: "hidden-cleared" });
      },
    },
    {
      key: SNAP_KEY.toLowerCase(),
      run: () => {
        store.dispatch({ type: "snap-toggled" });
        // The drag under the pointer, if there is one, computes its pose from
        // the lattice as it stands: redraw it so the screen keeps showing what
        // a release would write.
        props.commands.redrawGesture();
      },
    },
    // Every gizmo, on the keys the toolbar shows beside each one.
    // Switching is not an edit, so it is not gated on the level being writable
    // — a read-only level still draws the gizmo, and the gesture is what
    // refuses.
    ...TOOLS.map((entry) => ({
      key: entry.key.toLowerCase(),
      run: () => {
        store.dispatch({ type: "tool-changed", tool: entry.mode });
      },
    })),
  ]);

  return (
    <div className="yage-editor">
      <style>{EDITOR_CSS}</style>

      <div className="ye-bar">
        <Select
          label="Level"
          testId="level-picker"
          title="Which level is open"
          value={filePath ?? ""}
          placeholder={
            levels.length === 0 ? "No levels found" : "No level open"
          }
          disabled={levels.length === 0}
          options={levels.map((level) => ({
            value: level.path,
            label: level.path,
          }))}
          onChange={(path) => {
            void props.files.openLevel(path);
          }}
        />
        <div className="ye-group">
          <Button
            testId="new-level"
            title="Create a level with nothing in it, and open it"
            onClick={() => {
              setLevelRequest({ kind: "new" });
            }}
          >
            New
          </Button>
          <Button
            testId="duplicate-level"
            disabled={filePath === undefined}
            title="Copy this level under another name, and open the copy"
            onClick={() => {
              if (filePath !== undefined) {
                setLevelRequest({ kind: "duplicate", source: filePath });
              }
            }}
          >
            Duplicate
          </Button>
          <Button
            testId="delete-level"
            disabled={filePath === undefined}
            title="Remove this level file"
            onClick={() => {
              if (filePath !== undefined) {
                setLevelRequest({ kind: "delete", path: filePath });
              }
            }}
          >
            Delete
          </Button>
        </div>
        {dirty ? (
          <span className="ye-badge" data-testid="dirty-marker">
            unsaved
          </span>
        ) : null}
        <div className="ye-bar__actions">
          <Button
            testId="save-level"
            disabled={filePath === undefined || !dirty || locked}
            onClick={() => {
              void props.files.save();
            }}
          >
            Save
          </Button>
          <Button
            testId="play-level"
            disabled={filePath === undefined}
            title="Run this level as it stands, in the editor's own page"
            onClick={() => {
              void props.files.play();
            }}
          >
            Play
          </Button>
          {props.files.runnable ? (
            <Button
              className="ye-button ye-button--primary"
              testId="run-level"
              disabled={filePath === undefined || locked}
              title="Open the level in the game's own page, which loads the file"
              onClick={() => {
                void props.files.run();
              }}
            >
              {dirty ? "Save and Run" : "Run"}
            </Button>
          ) : null}
        </div>
      </div>

      <Toolbar
        tool={tool}
        onTool={(next) => {
          store.dispatch({ type: "tool-changed", tool: next });
        }}
        pivot={pivot}
        onPivot={(next) => {
          store.dispatch({ type: "pivot-changed", pivot: next });
        }}
        axes={axes}
        onAxes={(next) => {
          store.dispatch({ type: "axes-changed", axes: next });
        }}
        guides={guides}
        onGuides={() => {
          store.dispatch({ type: "guides-toggled" });
        }}
        snap={snap}
        onSnap={() => {
          store.dispatch({ type: "snap-toggled" });
          props.commands.redrawGesture();
        }}
        step={step}
        onStep={(next) => {
          store.dispatch({ type: "step-changed", step: next });
          props.commands.redrawGesture();
        }}
        canUndo={editable && undoDepth > 0}
        canRedo={editable && redoDepth > 0}
        canDelete={editable && hasSelection}
        onUndo={() => {
          void props.commands.undo();
        }}
        onRedo={() => {
          void props.commands.redo();
        }}
        onDelete={() => {
          void props.commands.deletePlacements([...store.getState().selection]);
        }}
        canHide={hasSelection}
        canShowAll={anythingHidden}
        onHide={() => {
          hideSelection(store);
        }}
        onIsolate={() => {
          const state = store.getState();
          store.dispatch({
            type: "hidden-set",
            ids: rootsWithout(state.document, state.selection),
          });
        }}
        onShowAll={() => {
          store.dispatch({ type: "hidden-cleared" });
        }}
        canArrange={editable && arrangeable >= 2}
        canDistribute={editable && arrangeable >= 3}
        onAlign={(edge) => {
          props.commands.alignPlacements([...store.getState().selection], edge);
        }}
        onDistribute={(axis) => {
          props.commands.distributePlacements(
            [...store.getState().selection],
            axis,
          );
        }}
      />

      <ControlBar
        store={store}
        editable={editable}
        onSetName={(id, name) => {
          props.commands.setName(id, name);
        }}
        onSetPose={(ids, component, value) => {
          props.commands.setPose(ids, component, value);
        }}
        onDraftPose={(ids, component, value) => {
          props.commands.draftPose(ids, component, value);
        }}
        onCancelPoseDraft={() => {
          props.commands.cancelPoseDraft();
        }}
      />

      {locked ? (
        <p className="ye-banner" data-testid="write-lock">
          Editing is paused: {writesLocked.join(", ")}.
        </p>
      ) : null}

      <div className="ye-body">
        <aside className="ye-body__left">
          <Hierarchy
            store={store}
            onSelect={(id, additive) => {
              const selection = store.getState().selection;
              store.dispatch({
                type: "selection-changed",
                ids: selectedAfter(selection, id, additive),
              });
            }}
            onPickTarget={(id) => {
              props.commands.pickTarget(id);
            }}
            onToggleHidden={(id) => {
              store.dispatch({ type: "hidden-toggled", ids: [id] });
            }}
            onDrop={(id, drop) => {
              // Dragging a row that is part of the selection drags the whole
              // selection; dragging one outside it drags only that row, which
              // is what the row under the pointer looks like it will do.
              const selection = store.getState().selection;
              props.commands.movePlacements(
                selection.has(id) ? [...selection] : [id],
                drop,
              );
            }}
          />
        </aside>

        <div className="ye-body__center">
          <Viewport
            canvasHost={props.canvasHost}
            store={props.store}
            commands={props.commands}
            preview={props.preview}
          />

          <Actors
            store={store}
            placeables={props.placeables}
            assetPaths={assetPaths}
            onPlace={(typeId) => {
              props.commands.createPlacement(typeId);
            }}
          />

          <Problems store={store} />
        </div>

        <aside className="ye-body__right">
          <Inspector
            store={store}
            editable={editable}
            inspectable={props.inspectable}
            listAssets={props.listAssets}
            onSetParam={(ids, path, value) => {
              props.commands.setParam(ids, path, value);
            }}
            onResetParam={(ids, path) => {
              props.commands.resetParam(ids, path);
            }}
            onPickTarget={(id, field, types) => {
              props.commands.startPick(id, field, types);
            }}
            onCancelPick={() => {
              props.commands.cancelPick();
            }}
            onResetPlacement={(ids) => {
              props.commands.resetPlacements(ids);
            }}
            onSetKey={(id, key) => {
              props.commands.setKey(id, key);
            }}
            onSetActive={(ids, active) => {
              props.commands.setActive(ids, active);
            }}
            layerChoices={props.layerChoices}
            layerSorts={props.layerSorts}
            onSetLayer={(ids, layer) => {
              props.commands.setLayer(ids, layer);
            }}
            onOrder={(ids, direction) => {
              props.commands.orderPlacements(ids, direction);
            }}
          />
        </aside>
      </div>

      <DeleteConfirm store={store} commands={props.commands} />

      {levelRequest === undefined ? null : levelRequest.kind === "delete" ? (
        <DeleteLevelConfirm
          path={levelRequest.path}
          dirty={dirty && filePath === levelRequest.path}
          onConfirm={() => {
            void props.files.deleteLevel(levelRequest.path).then(() => {
              setLevelRequest(undefined);
            });
          }}
          onCancel={() => {
            setLevelRequest(undefined);
          }}
        />
      ) : (
        <NewLevelDialog
          // A fresh dialog per question, so opening Duplicate over New starts
          // on the copy's name rather than on what was typed for the other.
          key={levelRequest.kind === "duplicate" ? levelRequest.source : "new"}
          request={levelRequest}
          directories={props.levelDirectories}
          levels={levels}
          dirty={dirty && filePath === duplicatedSource(levelRequest)}
          reason={awaiting === undefined ? undefined : fileProblem}
          onSubmit={(path, levelId) => {
            // The old answer goes before the new question is asked, so what
            // the dialog shows next is this request's and not the last one's.
            store.dispatch({
              type: "diagnostics-replaced",
              source: "file",
              diagnostics: [],
            });
            setAwaiting(path);
            void (levelRequest.kind === "duplicate"
              ? props.files.duplicateLevel(levelRequest.source, path, levelId)
              : props.files.createLevel(path, levelId));
          }}
          onCancel={() => {
            setAwaiting(undefined);
            setLevelRequest(undefined);
          }}
        />
      )}
    </div>
  );
}

/** The level a Duplicate copies, and nothing for a New. */
function duplicatedSource(request: LevelRequest): string | undefined {
  return request.kind === "duplicate" ? request.source : undefined;
}

/**
 * Take the selection off the screen, or put it back.
 *
 * The roots alone: everything authored under a hidden placement is hidden with
 * it, and naming a child as well would leave it hidden after its parent came
 * back.
 */
function hideSelection(store: EditorStore): void {
  const state = store.getState();
  store.dispatch({
    type: "hidden-toggled",
    ids: selectionRoots(state.document, state.selection),
  });
}

/**
 * What a delete would break, asked before it happens.
 *
 * The question is only worth asking when something outside the removed set
 * points into it, so `CommandController` decides whether to open it and this
 * renders whatever it opened. The referrers are derived from the live document
 * on each render rather than captured when the question was asked, so an undo
 * or another tab's edit cannot leave a stale list on screen.
 *
 * Confirming leaves the referring ids exactly as they are. Preparation then
 * reports each as a missing target, which is repairable in one click and which
 * one undo puts back.
 */
function DeleteConfirm({
  store,
  commands,
}: {
  store: EditorStore;
  commands: CommandController;
}): React.JSX.Element | null {
  const pending = useEditorSlice(store, (state) => state.pendingDelete);
  const entities = useEditorSlice(store, (state) => state.document.entities);
  if (pending === undefined) return null;
  const removing = new Set(pending);
  const referrers = inboundReferences(entities, removing, (typeId) =>
    commands.referenceFields(typeId),
  );
  const labelOf = (id: string): string => {
    const placement = entities.find((one) => one.id === id);
    return placement?.name ?? placement?.key ?? id;
  };

  return (
    <div data-testid="delete-confirm" role="alertdialog" className="ye-confirm">
      <p>
        {pending.length === 1
          ? `Deleting ${labelOf(pending[0] ?? "")} leaves these pointing at nothing:`
          : `Deleting these ${String(pending.length)} placements leaves these pointing at nothing:`}
      </p>
      <ul data-testid="delete-confirm-referrers" className="ye-messages">
        {referrers.map((use) => (
          <li key={`${use.placementId}-${use.field}`}>
            {labelOf(use.placementId)} — {use.field} → {labelOf(use.targetId)}
          </li>
        ))}
      </ul>
      <div className="ye-confirm__actions">
        <Button
          testId="confirm-delete"
          onClick={() => {
            void commands.confirmDelete();
          }}
        >
          Delete anyway
        </Button>
        <Button
          testId="cancel-delete"
          onClick={() => {
            store.dispatch({ type: "delete-confirm-dismissed" });
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
