import {
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  hiddenClosure,
  placementTree,
  referenceTargets,
  type HierarchyDrop,
  type PlacementNode,
  withDescendants,
} from "../commands/index.js";
import { isEditable, type EditorStore } from "../store/index.js";
import { Button } from "./controls.js";
import { Panel, PanelEmpty } from "./Panel.js";
import { useEditorSlice } from "./useEditorSlice.js";

export interface HierarchyProps {
  readonly store: EditorStore;
  /** `additive` is the modifier the developer held: toggle rather than replace. */
  readonly onSelect: (id: string, additive: boolean) => void;
  readonly onDrop: (id: string, drop: HierarchyDrop) => void;
  /** Choose this placement as the waiting reference field's target. */
  readonly onPickTarget: (id: string) => void;
  /** Hide this placement, or show it again. */
  readonly onToggleHidden: (id: string) => void;
}

/** Which row the pointer is over during a drag, and what a release would do. */
interface DropHover {
  readonly id: string;
  readonly kind: "before" | "into" | "after";
}

/**
 * The authored placements as a tree: parents above children, siblings in
 * document order. Only what the document holds is listed — the entities a
 * placement's `setup()` spawns are runtime, and the runtime is not authored.
 *
 * A row shows the placement's name when it has one, otherwise its type, and
 * always its id, since names may repeat. One row drags: dropped before or
 * after another row it takes that row's parent and position; dropped onto a
 * row it becomes that row's last child; dropped on the area under the tree it
 * becomes a top-level placement. While a row is dragged, its own subtree
 * offers no targets — a placement cannot be its own ancestor, and the
 * controller and reducer refuse it too.
 *
 * The three outcomes look different rather than sharing one highlight: a line
 * at the row's own indent for before and after, so the depth the placement
 * lands at is visible, and an outline around the whole row for into. The lines
 * are drawn on the list item, which holds the row and everything nested under
 * it — dropping after a row puts the placement after that row's whole subtree,
 * and the row's own bottom edge is above its children.
 *
 * Each row carries an eye that takes the placement off the screen and brings
 * it back. A hidden row greys and keeps its eye showing, and it still selects
 * and drags, so the inspector can reach a placement that is out of the way and
 * the eye can bring it back.
 *
 * While a reference field is waiting for a target, a row that can be one
 * chooses it instead of selecting, every other row is inert, and no row drags.
 *
 * It reads the document, the selection and whether the level is writable from
 * the store itself: the shell subscribes to none of the three, so a panel that
 * was handed them would draw the level as it stood at the shell's last render.
 */
export function Hierarchy(props: HierarchyProps): React.JSX.Element {
  const document = useEditorSlice(props.store, (state) => state.document);
  const selection = useEditorSlice(props.store, (state) => state.selection);
  // False while writes are locked: rows still select, but nothing drags.
  const editable = useEditorSlice(props.store, isEditable);
  const pick = useEditorSlice(props.store, (state) => state.pick);
  const hiddenIds = useEditorSlice(props.store, (state) => state.hidden);
  // While a field is waiting, the tree does one thing. A candidate authored
  // inactive draws nothing and one the projection left out has no entity at
  // all, so neither can be clicked in the viewport, and both are rows here.
  const targets = pick
    ? referenceTargets(document.entities, pick.types)
    : undefined;
  // The closure, so a child of a hidden parent greys with it: the viewport
  // draws nothing for it either, and a row that looked ordinary would be the
  // one place claiming otherwise.
  const hidden = hiddenClosure(document, hiddenIds);
  const [dragging, setDragging] = useState<string | undefined>();
  const [hover, setHover] = useState<DropHover | undefined>();
  const roots = placementTree(document);
  const excluded =
    dragging === undefined
      ? new Set<string>()
      : new Set(withDescendants(document.entities, [dragging]));
  const dropTargets = editable && dragging !== undefined;
  const count = document.entities.length;

  const endDrag = (): void => {
    setDragging(undefined);
    setHover(undefined);
  };

  // A `dragover` fires every frame of the gesture. Setting a fresh object each
  // time would re-render the whole tree throughout the drag; React's bail-out
  // needs the state to be the same value, not an equal one.
  const hoverOver = (id: string, kind: DropHover["kind"]): void => {
    setHover((held) =>
      held?.id === id && held.kind === kind ? held : { id, kind },
    );
  };

  const drop = (target: HierarchyDrop): void => {
    if (dragging === undefined) return;
    props.onDrop(dragging, target);
    endDrag();
  };

  const row = (node: PlacementNode, level: number): React.JSX.Element => {
    const { placement } = node;
    const id = placement.id;
    const selected = selection.has(id);
    const over = hover?.id === id ? hover.kind : undefined;
    const target = targets?.get(id);
    const unpickable = targets !== undefined && target === undefined;
    const away = hidden.has(id);
    return (
      <li
        key={id}
        role="treeitem"
        aria-selected={selected}
        aria-level={level}
        className="ye-item"
        data-testid={`hierarchy-item-${id}`}
        data-drop={over}
        style={{
          // The indent is state, so it stays here. The stylesheet reads it for
          // the row's padding and for the drop line, which is what puts the
          // line at the depth the placement would land at. It sits on the item
          // rather than the row because the line is drawn on the item.
          ["--row-indent" as string]: `${String(12 + level * 14)}px`,
        }}
      >
        <div
          data-testid={`hierarchy-row-${id}`}
          className={`ye-row${selected ? " is-selected" : ""}${
            editable ? "" : " is-static"
          }${unpickable ? " is-unpickable" : ""}${away ? " is-hidden" : ""}`}
          draggable={editable && targets === undefined}
          onClick={(event: ReactMouseEvent) => {
            if (targets !== undefined) {
              if (target !== undefined) props.onPickTarget(target);
              return;
            }
            props.onSelect(id, event.metaKey || event.ctrlKey);
          }}
          onDragStart={(event: ReactDragEvent) => {
            if (!editable) {
              event.preventDefault();
              return;
            }
            // The dragged id lives in component state; the transfer payload
            // exists because Firefox starts no drag without one. Its type is
            // private on purpose: a `text/plain` payload is something a text
            // input accepts, and a row dropped into the inspector's field would
            // commit the id as a path. Absent when a test dispatches a plain
            // event, which is what the cast admits.
            const transfer = event.dataTransfer as DataTransfer | undefined;
            transfer?.setData("application/x-yage-placement", id);
            setDragging(id);
          }}
          onDragEnd={endDrag}
          // One place decides how faded a row is: an inline opacity beats the
          // stylesheet, so a rule there would never reach a row.
          style={{
            opacity: dragging === id ? 0.5 : unpickable || away ? 0.4 : 1,
          }}
        >
          <span className="ye-row__name">
            {placement.name ?? placement.type}
          </span>
          <small className="ye-row__id">{id}</small>
          <Button
            className={`ye-row__eye${away ? " is-on" : ""}`}
            testId={`hierarchy-eye-${id}`}
            title={away ? "Show this placement" : "Hide this placement"}
            pressed={away}
            onClick={(event) => {
              // The row underneath selects, and this is not a way of choosing
              // what to work on.
              event.stopPropagation();
              props.onToggleHidden(id);
            }}
          >
            {/* Solid while the placement is on screen, broken while it is
                not. The title says which, for a reader the shape does not. */}
            {away ? "◌" : "◉"}
          </Button>
          {dropTargets && !excluded.has(id) ? (
            <>
              <DropZone
                testId={`drop-before-${id}`}
                kind="before"
                onEnter={() => {
                  hoverOver(id, "before");
                }}
                onLeave={() => {
                  setHover(undefined);
                }}
                onDrop={() => {
                  drop({ kind: "before", siblingId: id });
                }}
              />
              <DropZone
                testId={`drop-into-${id}`}
                kind="into"
                onEnter={() => {
                  hoverOver(id, "into");
                }}
                onLeave={() => {
                  setHover(undefined);
                }}
                onDrop={() => {
                  drop({ kind: "into", parentId: id });
                }}
              />
              <DropZone
                testId={`drop-after-${id}`}
                kind="after"
                onEnter={() => {
                  hoverOver(id, "after");
                }}
                onLeave={() => {
                  setHover(undefined);
                }}
                onDrop={() => {
                  drop({ kind: "after", siblingId: id });
                }}
              />
            </>
          ) : null}
        </div>
        {node.children.length > 0 ? (
          <ul role="group" className="ye-subtree">
            {node.children.map((child) => row(child, level + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <Panel
      title="Hierarchy"
      testId="hierarchy"
      note={count === 0 ? undefined : String(count)}
    >
      {roots.length === 0 ? (
        <PanelEmpty>No placements</PanelEmpty>
      ) : (
        <ul role="tree" className="ye-tree">
          {roots.map((root) => row(root, 1))}
        </ul>
      )}
      {dropTargets ? (
        <div
          data-testid="drop-root"
          className={`ye-drop-root${hover?.id === ROOT ? " is-over" : ""}`}
          onDragOver={(event: ReactDragEvent) => {
            allowDrop(event);
            hoverOver(ROOT, "into");
          }}
          onDragLeave={() => {
            setHover(undefined);
          }}
          onDrop={(event: ReactDragEvent) => {
            event.preventDefault();
            drop({ kind: "root" });
          }}
        >
          Drop here to make top-level
        </div>
      ) : null}
    </Panel>
  );
}

/**
 * The hover key for the area under the tree. A placement id cannot collide
 * with it: the document layer requires a non-empty id.
 */
const ROOT = "";

/**
 * One drop target laid over part of a row. Three cover a row while a drag
 * runs: the top 30% (before), the middle (onto), the bottom 30% (after). They
 * exist only during a drag, so an ordinary click never lands on one.
 *
 * A zone reports what it is over and draws nothing itself. The row draws,
 * because before and after are edges of the row rather than bands inside it.
 */
function DropZone({
  testId,
  kind,
  onEnter,
  onLeave,
  onDrop,
}: {
  testId: string;
  kind: DropHover["kind"];
  onEnter: () => void;
  onLeave: () => void;
  onDrop: () => void;
}): React.JSX.Element {
  return (
    <div
      data-testid={testId}
      className={`ye-drop ye-drop--${kind}`}
      onDragOver={(event: ReactDragEvent) => {
        allowDrop(event);
        onEnter();
      }}
      onDragLeave={onLeave}
      onDrop={(event: ReactDragEvent) => {
        event.preventDefault();
        onDrop();
      }}
    />
  );
}

/** A drop is allowed only where the default is prevented. */
function allowDrop(event: ReactDragEvent): void {
  event.preventDefault();
}
