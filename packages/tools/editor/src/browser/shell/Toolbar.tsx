import {
  edgeAxis,
  type AlignEdge,
  type ArrangeAxis,
} from "../commands/index.js";
import {
  clampStep,
  MAX_STEP,
  MIN_STEP,
  type AxisMode,
  type EditorTool,
  type PivotMode,
} from "../store/index.js";
import { Button, TextField } from "./controls.js";

/** A tool, its label, and the key that also picks it. */
interface ToolChoice {
  readonly mode: EditorTool;
  readonly label: string;
  readonly key: string;
}

/**
 * What the viewport can be in, on the keys `Q` through `T` under one hand.
 *
 * Select comes first because it changes nothing: it is where you are when you
 * are deciding what to work on. The three gizmos follow in the order every
 * editor puts them in, and Transform comes last because it carries all three
 * at once on the placement's own box.
 */
export const TOOLS: readonly ToolChoice[] = [
  { mode: "select", label: "Select", key: "Q" },
  { mode: "translate", label: "Move", key: "W" },
  { mode: "rotate", label: "Rotate", key: "E" },
  { mode: "scale", label: "Scale", key: "R" },
  { mode: "box", label: "Transform", key: "T" },
];

/**
 * What rotate and scale work about, and which axes the gizmo lies along.
 *
 * They modify what the tools do, so they sit between the tools and the
 * reference guides. Neither takes a key: `Q` through `T`, `G`, and `S` are
 * spoken for, and these are picked far less often than a tool.
 */
const PIVOTS: readonly { mode: PivotMode; label: string; title: string }[] = [
  {
    mode: "active",
    label: "Active",
    title: "Turn and scale about the last placement selected",
  },
  {
    mode: "center",
    label: "Center",
    title: "Turn and scale about the middle of the selection",
  },
  {
    mode: "individual",
    label: "Each",
    title: "Turn and scale each placement about its own origin",
  },
];

/**
 * Which axes a move follows, and only a move.
 *
 * A turn is about the screen normal, so there is one ring and no axis to
 * choose. A scale can only grow a placement along its own axes, because that
 * is what `scale.x` and `scale.y` mean; measuring the drag on a foreign axis
 * would ask a level transform to hold a shear. So the choice is offered where
 * it changes something and disabled where it would not.
 */
const AXES: readonly { mode: AxisMode; label: string; title: string }[] = [
  {
    mode: "local",
    label: "Local",
    title: "Move along the active placement's own axes",
  },
  {
    mode: "world",
    label: "World",
    title: "Move along the level's axes",
  },
];

/** The key that switches the reference guides. */
export const GUIDES_KEY = "G";

/** The key that switches snapping. */
export const SNAP_KEY = "S";

/**
 * The key that hides the selection, and with `Shift` shows everything again.
 *
 * Hiding is not an edit: it takes a placement off the screen and out of the
 * way of a press, and it never reaches the level file.
 */
export const HIDE_KEY = "H";

/**
 * The six alignments, in the order a design tool puts them: the three that act
 * on x, then the three on y, each running from the low edge through the middle
 * to the high one.
 */
const ALIGNMENTS: readonly { edge: AlignEdge; title: string }[] = [
  { edge: "left", title: "Line the left edges up" },
  { edge: "centerX", title: "Line the horizontal centres up" },
  { edge: "right", title: "Line the right edges up" },
  { edge: "top", title: "Line the top edges up" },
  { edge: "centerY", title: "Line the vertical centres up" },
  { edge: "bottom", title: "Line the bottom edges up" },
];

/** The two distributions, on the same two axes and in the same order. */
const DISTRIBUTIONS: readonly { axis: ArrangeAxis; title: string }[] = [
  { axis: "x", title: "Leave an equal gap between them, left to right" },
  { axis: "y", title: "Leave an equal gap between them, top to bottom" },
];

/**
 * One block of the icon, laid out along the axis the button acts on.
 *
 * `at` and `length` run along that axis, `across` and `thickness` across it,
 * and all four are fractions of the icon's square — so the same numbers draw
 * the horizontal button and the vertical one.
 */
function Block(props: {
  axis: ArrangeAxis;
  at: number;
  length: number;
  across: number;
  thickness: number;
}): React.JSX.Element {
  const along = props.axis === "x";
  return (
    <rect
      x={(along ? props.at : props.across) * 16}
      y={(along ? props.across : props.at) * 16}
      width={(along ? props.length : props.thickness) * 16}
      height={(along ? props.thickness : props.length) * 16}
      fill="currentColor"
    />
  );
}

/**
 * Three blocks of unequal length in three lanes, meeting the line the
 * alignment moves them to.
 *
 * Unequal lengths are the point: they are what shows that the button moves an
 * edge rather than a centre.
 */
function AlignIcon(props: { edge: AlignEdge }): React.JSX.Element {
  const axis = edgeAxis(props.edge);
  const low = props.edge === "left" || props.edge === "top";
  const high = props.edge === "right" || props.edge === "bottom";
  const rule = low ? 0.5 / 16 : high ? 15.5 / 16 : 0.5;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <line
        x1={(axis === "x" ? rule : 0) * 16}
        y1={(axis === "x" ? 0 : rule) * 16}
        x2={(axis === "x" ? rule : 1) * 16}
        y2={(axis === "x" ? 1 : rule) * 16}
        stroke="currentColor"
        strokeWidth={1}
      />
      {[0.9, 0.45, 0.7].map((length, lane) => (
        <Block
          key={lane}
          axis={axis}
          at={low ? 0.08 : high ? 0.92 - length : 0.5 - length / 2}
          length={length}
          across={0.16 + lane * 0.28}
          thickness={0.16}
        />
      ))}
    </svg>
  );
}

/**
 * Three blocks of unequal length in one lane, with an equal gap on either side
 * of the middle one. Unequal lengths again: what the button equalizes is the
 * gaps and not the strides.
 */
function DistributeIcon(props: { axis: ArrangeAxis }): React.JSX.Element {
  const blocks = [
    { at: 0, length: 0.28 },
    { at: 0.42, length: 0.16 },
    { at: 0.72, length: 0.28 },
  ];
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {blocks.map((block, index) => (
        <Block
          key={index}
          axis={props.axis}
          at={block.at}
          length={block.length}
          across={0.15}
          thickness={0.7}
        />
      ))}
    </svg>
  );
}

export interface ToolbarProps {
  readonly tool: EditorTool;
  readonly onTool: (tool: EditorTool) => void;
  readonly pivot: PivotMode;
  readonly onPivot: (pivot: PivotMode) => void;
  readonly axes: AxisMode;
  readonly onAxes: (axes: AxisMode) => void;
  readonly guides: boolean;
  readonly onGuides: () => void;
  readonly snap: boolean;
  readonly onSnap: () => void;
  readonly step: number;
  readonly onStep: (step: number) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canDelete: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onDelete: () => void;
  /** Whether anything is selected, which both Hide and Isolate act on. */
  readonly canHide: boolean;
  /** Whether anything is hidden, which is when Show all has work to do. */
  readonly canShowAll: boolean;
  readonly onHide: () => void;
  readonly onIsolate: () => void;
  readonly onShowAll: () => void;
  /** Whether two or more selected roots share one parent, which align needs. */
  readonly canArrange: boolean;
  /** The same for three or more, which is the fewest a gap can be equal across. */
  readonly canDistribute: boolean;
  readonly onAlign: (edge: AlignEdge) => void;
  readonly onDistribute: (axis: ArrangeAxis) => void;
}

/**
 * How wide the lattice is, in world units. Enter or blur commits a number
 * inside the bounds the store holds the step to; Escape puts the one in force
 * back, and an entry outside them keeps its text with the reason beside it.
 *
 * The box refuses exactly what `clampStep` would have moved, so no entry ever
 * comes back as a different number than the one that was typed.
 *
 * It commits typed text on the way out rather than on each keystroke: typing
 * `64` over a `32` would otherwise redraw the grid at 6 on the way through.
 *
 * Up and Down double and halve, and so does dragging the label. The box spans
 * 1 to 10000, where adding one is useless above about a hundred, and doubling
 * walks the sizes art comes in — 16, 32, 64, 128 — with the default already on
 * that run. Any other number is still typed, which is exact and is what the
 * box is for. The lattice is view state and takes no history entry, so every
 * step commits at once instead of waiting for a blur to show its effect.
 */
function StepField(props: {
  step: number;
  onStep: (step: number) => void;
}): React.JSX.Element {
  return (
    <TextField
      className="ye-step"
      label="Step"
      testId="grid-step"
      title="World units between grid lines. Up and Down double and halve it."
      numeric
      value={String(props.step)}
      reject={(text) => {
        const step = Number(text.trim());
        return step >= MIN_STEP && step <= MAX_STEP
          ? undefined
          : `A number from ${String(MIN_STEP)} to ${String(MAX_STEP)}.`;
      }}
      stepping={{
        step: (text, intent) => {
          const from = Number(text.trim());
          if (!Number.isFinite(from) || from <= 0) return undefined;
          return String(clampStep(intent.direction > 0 ? from * 2 : from / 2));
        },
        commitEach: true,
      }}
      onCommit={(text) => {
        props.onStep(Number(text.trim()));
      }}
    />
  );
}

/**
 * What acts on the level: which gizmo is live, the three edit actions, and
 * what the viewport draws for reference.
 *
 * The file's own actions are on the bar above this one. Keeping them apart is
 * the difference between a row of buttons and a row that says what it is for.
 */
export function Toolbar(props: ToolbarProps): React.JSX.Element {
  return (
    <div className="ye-bar ye-bar--tools" data-testid="toolbar">
      <div className="ye-group" role="group" aria-label="Viewport tool">
        {TOOLS.map((tool) => (
          <Button
            key={tool.mode}
            className="ye-tool"
            testId={`tool-${tool.mode}`}
            pressed={props.tool === tool.mode}
            title={`${tool.label} (${tool.key})`}
            onClick={() => {
              props.onTool(tool.mode);
            }}
          >
            {tool.label}
            <kbd>{tool.key}</kbd>
          </Button>
        ))}
      </div>

      <div className="ye-group" role="group" aria-label="Pivot">
        {PIVOTS.map((choice) => (
          <Button
            key={choice.mode}
            className="ye-tool"
            testId={`pivot-${choice.mode}`}
            pressed={props.pivot === choice.mode}
            title={choice.title}
            onClick={() => {
              props.onPivot(choice.mode);
            }}
          >
            {choice.label}
          </Button>
        ))}
      </div>

      <div className="ye-group" role="group" aria-label="Gizmo axes">
        {AXES.map((choice) => (
          <Button
            key={choice.mode}
            className="ye-tool"
            testId={`axes-${choice.mode}`}
            pressed={props.axes === choice.mode}
            disabled={props.tool !== "translate"}
            title={choice.title}
            onClick={() => {
              props.onAxes(choice.mode);
            }}
          >
            {choice.label}
          </Button>
        ))}
      </div>

      <div className="ye-group">
        <Button testId="undo" disabled={!props.canUndo} onClick={props.onUndo}>
          Undo
        </Button>
        <Button testId="redo" disabled={!props.canRedo} onClick={props.onRedo}>
          Redo
        </Button>
        <Button
          testId="delete-selection"
          disabled={!props.canDelete}
          onClick={props.onDelete}
        >
          Delete
        </Button>
      </div>

      {/* Taking a placement out of the way is not editing it: nothing here
          reaches the file, and all three work on a level that refuses
          writes. */}
      <div className="ye-group" role="group" aria-label="Hiding">
        <Button
          testId="hide-selection"
          disabled={!props.canHide}
          title={`Take the selection off the screen, or put it back (${HIDE_KEY})`}
          onClick={props.onHide}
        >
          Hide
          <kbd>{HIDE_KEY}</kbd>
        </Button>
        <Button
          testId="isolate-selection"
          disabled={!props.canHide}
          title="Hide everything the selection is not part of"
          onClick={props.onIsolate}
        >
          Isolate
        </Button>
        <Button
          testId="show-all"
          disabled={!props.canShowAll}
          title={`Put everything hidden back on the screen (Shift-${HIDE_KEY})`}
          onClick={props.onShowAll}
        >
          Show all
        </Button>
      </div>

      {/* Eight one-shot edits over the whole selection. They are enabled by
          what the selection is rather than by the tool, because lining things
          up is an answer to where they already are. */}
      <div className="ye-group" role="group" aria-label="Arrange">
        {ALIGNMENTS.map((choice) => (
          <Button
            key={choice.edge}
            className="ye-button ye-icon"
            testId={`align-${choice.edge}`}
            disabled={!props.canArrange}
            title={choice.title}
            ariaLabel={choice.title}
            onClick={() => {
              props.onAlign(choice.edge);
            }}
          >
            <AlignIcon edge={choice.edge} />
          </Button>
        ))}
        {DISTRIBUTIONS.map((choice) => (
          <Button
            key={choice.axis}
            className="ye-button ye-icon"
            testId={`distribute-${choice.axis}`}
            disabled={!props.canDistribute}
            title={choice.title}
            ariaLabel={choice.title}
            onClick={() => {
              props.onDistribute(choice.axis);
            }}
          >
            <DistributeIcon axis={choice.axis} />
          </Button>
        ))}
      </div>

      {/* One lattice, three controls: Guides draws it, Snap lands on it, and
          the number sizes it. */}
      <div className="ye-group" role="group" aria-label="Grid">
        <Button
          testId="toggle-guides"
          pressed={props.guides}
          title={`Grid, axes, and the default viewport (${GUIDES_KEY})`}
          onClick={props.onGuides}
        >
          Guides
          <kbd>{GUIDES_KEY}</kbd>
        </Button>
        <Button
          testId="toggle-snap"
          pressed={props.snap}
          title={`Land moves on the grid, and a stretch's dragged side (${SNAP_KEY}). Hold Alt to stay off it.`}
          onClick={props.onSnap}
        >
          Snap
          <kbd>{SNAP_KEY}</kbd>
        </Button>
        <StepField step={props.step} onStep={props.onStep} />
      </div>
    </div>
  );
}
