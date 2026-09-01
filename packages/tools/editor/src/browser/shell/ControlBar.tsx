import type { LevelPlacement, LevelTransform } from "@yagejs/level/document";
import { gesturePoses, poseNumber, withPoseNumber } from "../commands/index.js";
import type {
  EditorState,
  EditorStore,
  PoseComponent,
} from "../store/index.js";
import { TextField, trimmedOrNull, type StepIntent } from "./controls.js";
import { useEditorState } from "./useEditorSlice.js";

export interface ControlBarProps {
  readonly store: EditorStore;
  readonly editable: boolean;
  readonly onSetName: (id: string, name: string | null) => void;
  readonly onSetPose: (id: string, transform: LevelTransform) => void;
  /**
   * One number of a transform, part-way through being stepped or scrubbed:
   * held and drawn, not written. The box commits it on Enter or blur.
   */
  readonly onDraftPose: (
    id: string,
    component: PoseComponent,
    value: number,
  ) => void;
  /** Escape: drop that number and put the viewport back on the document. */
  readonly onCancelPoseDraft: () => void;
}

/**
 * The name and the pose of the one selected placement, on a bar of their own
 * under the toolbar.
 *
 * These are the numbers a developer reaches for while working the viewport,
 * and there are always exactly six of them, which is what a bar can hold. The
 * declared parameters vary in count and an asset path needs width, so they
 * stay in the inspector panel at the side.
 *
 * It subscribes to the whole state: it reads the document, the selection, the
 * grid step and the running gesture, and a drag is the one thing it has to
 * follow number by number.
 */
export function ControlBar(props: ControlBarProps): React.JSX.Element {
  const state = useEditorState(props.store);
  const selected = [...state.selection];
  const placement =
    selected.length === 1
      ? state.document.entities.find((one) => one.id === selected[0])
      : undefined;

  return (
    <div className="ye-bar ye-bar--controls" data-testid="control-bar">
      {placement ? (
        // Keyed by id so a box being edited does not carry its draft over to
        // the next selected placement.
        <PlacementControls
          key={placement.id}
          {...props}
          state={state}
          placement={placement}
        />
      ) : (
        <span className="ye-bar__empty" data-testid="control-bar-empty">
          {selected.length === 0
            ? "Nothing selected"
            : `${String(selected.length)} placements selected`}
        </span>
      )}
    </div>
  );
}

/** What every part below the bar takes: the props, the state, the subject. */
type PlacementProps = ControlBarProps & {
  readonly state: EditorState;
  readonly placement: LevelPlacement;
};

/**
 * A placement's name, then its pose as five typed numbers in the frame the
 * file holds — the placement's own local transform, which for a parented
 * placement is relative to its parent and for a root is where it sits in the
 * level.
 *
 * A number changes three ways: type it, press Up or Down, or drag the word
 * beside it. There are no arrow buttons. A press paints the placement at once
 * and holds the number; Enter or blur turns the whole focus session into one
 * command and one undo step, and Escape puts the document's number back. The
 * four numbers a field did not change travel with it unaltered.
 *
 * A typed or stepped number is exact, so nothing here lands it on the grid
 * whatever the snap setting says — `Shift` chooses the size of the step and
 * not a lattice to land on.
 */
function PlacementControls(props: PlacementProps): React.JSX.Element {
  const { placement } = props;
  const cell = props.state.view.step;
  // A drag never touches the document, so during one the numbers come from the
  // gesture — the same poses the viewport is drawing and the release will
  // write.
  const dragged = props.state.gesture
    ? gesturePoses(props.state, props.state.gesture).find(
        (pose) => pose.id === placement.id,
      )
    : undefined;
  const shown = dragged?.transform ?? placement.transform;
  const parent =
    placement.parent === undefined
      ? undefined
      : props.state.document.entities.find(
          (one) => one.id === placement.parent,
        );

  return (
    <>
      <TextField
        className="ye-name"
        label="Name"
        testId="placement-name"
        value={placement.name ?? ""}
        placeholder={placement.type}
        disabled={!props.editable}
        onCommit={(text) => {
          props.onSetName(placement.id, trimmedOrNull(text));
        }}
      />
      <div className="ye-group" data-testid="transform-fields">
        {TRANSFORM_FIELDS.map((spec) => (
          <TextField
            key={spec.testId}
            className="ye-num"
            label={spec.label}
            testId={spec.testId}
            numeric
            disabled={!props.editable}
            value={shownNumber(poseNumber(shown, spec.component))}
            reject={(text) => refusedNumber(text, props.editable)}
            stepping={{
              step: (text, intent) => steppedNumber(text, spec, intent, cell),
              onStep: (text) => {
                props.onDraftPose(placement.id, spec.component, Number(text));
              },
              onCancel: props.onCancelPoseDraft,
            }}
            onCommit={(text) => {
              props.onSetPose(
                placement.id,
                withPoseNumber(shown, spec.component, Number(text.trim())),
              );
            }}
          />
        ))}
      </div>
      {parent ? (
        <small className="ye-bar__note" data-testid="transform-frame">
          relative to {parent.name ?? parent.type}
        </small>
      ) : null}
    </>
  );
}

/** One number of a placement's local transform, and how far a press moves it. */
interface TransformFieldSpec {
  readonly label: string;
  readonly testId: string;
  readonly component: PoseComponent;
  /** How far one arrow press or one scrub step moves the number. */
  readonly step: number;
  /**
   * How far a press with `Shift` moves it. `"cell"` is one grid cell, which
   * the view sizes and the developer can change. `"double"` multiplies rather
   * than adds, which is what a scale needs.
   */
  readonly coarse: number | "cell" | "double";
  /** How far a press with `Alt` moves it. */
  readonly fine: number;
}

/**
 * The five numbers a level transform holds, in the units the bar types them
 * in, and the ladder each one steps by.
 *
 * `Shift` takes the unit the quantity is measured in rather than ten of the
 * ordinary step: one grid cell, 15°, and for a scale a halving or a doubling.
 * Ten pixels is not a quantity the editor draws or lands on, and one cell and
 * 15° are. Rotation's `Shift` is the same 15° a rotate drag steps by, so the
 * modifier means one thing in the viewport and in the bar.
 */
const TRANSFORM_FIELDS: readonly TransformFieldSpec[] = [
  {
    label: "X",
    testId: "transform-x",
    component: "x",
    step: 1,
    coarse: "cell",
    fine: 0.1,
  },
  {
    label: "Y",
    testId: "transform-y",
    component: "y",
    step: 1,
    coarse: "cell",
    fine: 0.1,
  },
  {
    label: "Rotation",
    testId: "transform-rotation",
    component: "rotation",
    step: 1,
    coarse: 15,
    fine: 0.1,
  },
  {
    label: "Scale X",
    testId: "transform-scale-x",
    component: "scaleX",
    step: 0.1,
    coarse: "double",
    fine: 0.01,
  },
  {
    label: "Scale Y",
    testId: "transform-scale-y",
    component: "scaleY",
    step: 0.1,
    coarse: "double",
    fine: 0.01,
  },
];

/** At most four decimals, trailing zeros dropped, and no negative zero. */
function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function shownNumber(value: number): string {
  return String(rounded(value));
}

/**
 * Why the typed text is not a number this field can take, if it is not.
 *
 * A locked level disables every box, so the lock reason is reached only by a
 * commit already under way when the lock arrived. Saying so is what keeps the
 * typed text on screen instead of replacing it with the document's number and
 * no explanation.
 */
function refusedNumber(text: string, editable: boolean): string | undefined {
  if (!editable) return "Editing is paused; this was not sent.";
  const typed = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(typed)) return "Type a number.";
  return undefined;
}

/**
 * The number one arrow press or one scrub step produces, or `undefined` when
 * the box is not showing a number to step from.
 */
function steppedNumber(
  text: string,
  spec: TransformFieldSpec,
  intent: StepIntent,
  cell: number,
): string | undefined {
  const from = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(from)) return undefined;
  return String(rounded(steppedTo(from, spec, intent, cell)));
}

/**
 * The number one press lands on, before it is rounded.
 *
 * A scale's coarse step multiplies, because a scale is a multiplier: halving
 * and doubling keep the sign, so a mirrored placement steps the way an
 * unmirrored one does. A scale of zero is a value — it is where a placement
 * that pops in under an animation starts — but the coarse step cannot reach it
 * or leave it, so type it or use the ordinary step.
 */
function steppedTo(
  from: number,
  spec: TransformFieldSpec,
  intent: StepIntent,
  cell: number,
): number {
  if (intent.coarse) {
    if (spec.coarse === "double") {
      return intent.direction === 1 ? from * 2 : from / 2;
    }
    const by = spec.coarse === "cell" ? cell : spec.coarse;
    return from + by * intent.direction;
  }
  return from + (intent.fine ? spec.fine : spec.step) * intent.direction;
}
