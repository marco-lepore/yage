import { useEffect, useState } from "react";
import type { EditorDiagnostic } from "../../shared/diagnostics/index.js";
import type {
  AssetListing,
  LevelSummary,
} from "../../shared/protocol/index.js";
import type { CommandController } from "../commands/index.js";
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
import { Panel } from "./Panel.js";
import { Button, Select } from "./controls.js";
import { selectedAfter } from "./selection.js";
import { EDITOR_CSS } from "./styles.js";
import { GUIDES_KEY, SNAP_KEY, TOOLS, Toolbar } from "./Toolbar.js";
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
   * Every level the server listed when the page loaded, in the order it listed
   * them — alphabetical by project-relative path. It does not change while the
   * page is open.
   */
  readonly levels: readonly LevelSummary[];
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
 * Its picker lists what the server found when the page loaded, so a level file
 * created since then needs a reload before it can be chosen.
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
  const writesLocked = useEditorSlice(store, (state) => state.writesLocked);
  const dirty = useEditorSlice(store, isDirty);
  const editable = useEditorSlice(store, isEditable);
  const hasSelection = useEditorSlice(
    store,
    (state) => state.selection.size > 0,
  );
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
      key: "f",
      run: () => {
        props.preview.frameSelection([...store.getState().selection]);
      },
    },
    {
      key: "f",
      shift: true,
      run: () => {
        store.dispatch({
          type: "view-changed",
          view: resetView(store.getState().view),
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
            props.levels.length === 0 ? "No levels found" : "No level open"
          }
          disabled={props.levels.length === 0}
          options={props.levels.map((level) => ({
            value: level.path,
            label: level.path,
          }))}
          onChange={(path) => {
            void props.files.openLevel(path);
          }}
        />
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
      />

      <ControlBar
        store={store}
        editable={editable}
        onSetName={(id, name) => {
          props.commands.setName(id, name);
        }}
        onSetPose={(id, transform) => {
          props.commands.setPose(id, transform);
        }}
        onDraftPose={(id, component, value) => {
          props.commands.draftPose(id, component, value);
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
        </div>

        <aside className="ye-body__right">
          <Inspector
            store={store}
            editable={editable}
            inspectable={props.inspectable}
            listAssets={props.listAssets}
            onSetParam={(id, field, value) => {
              props.commands.setParam(id, field, value);
            }}
            onResetParam={(id, field) => {
              props.commands.resetParam(id, field);
            }}
            onResetPlacement={(id) => {
              props.commands.resetPlacement(id);
            }}
            onSetKey={(id, key) => {
              props.commands.setKey(id, key);
            }}
          />
        </aside>
      </div>

      <Problems store={store} />
    </div>
  );
}

function Problems({ store }: { store: EditorStore }): React.JSX.Element | null {
  const diagnostics = useEditorSlice(store, (state) => state.diagnostics);
  const all: EditorDiagnostic[] = [...diagnostics.values()].flat();
  if (all.length === 0) return null;
  return (
    <div className="ye-problems">
      <Panel title="Problems" note={String(all.length)}>
        <ul data-testid="diagnostics">
          {all.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${String(index)}`}>
              <code>{diagnostic.source}</code>
              <span>{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
