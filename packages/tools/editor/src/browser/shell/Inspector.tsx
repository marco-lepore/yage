import type { ParamFieldDescription } from "@yagejs/level";
import type { JsonValue, LevelPlacement } from "@yagejs/level/document";
import { useEffect, useRef, useState } from "react";
import {
  derivedSceneKey,
  sceneKeyHolder,
} from "../../shared/commands/index.js";
import type { EditorDiagnostic } from "../../shared/diagnostics/index.js";
import type { AssetListing } from "../../shared/protocol/index.js";
import type { OrderDirection } from "../commands/index.js";
import type { LayerChoice } from "../layers.js";
import type { InspectableType } from "../project/index.js";
import type { EditorState, EditorStore } from "../store/index.js";
import { Panel, PanelEmpty } from "./Panel.js";
import type { SelectOption, StepIntent } from "./controls.js";
import {
  Button,
  Checkbox,
  Select,
  TextField,
  trimmedOrNull,
} from "./controls.js";
import { rounded } from "./numbers.js";
import { useEditorState } from "./useEditorSlice.js";

export interface InspectorProps {
  readonly store: EditorStore;
  readonly editable: boolean;
  /**
   * The inspector's view of a type, read on each render: the catalog can be
   * replaced while a placement stays selected.
   */
  readonly inspectable: (typeId: string) => InspectableType | undefined;
  /**
   * Every project asset, read fresh each time the picker opens. A failure
   * throws `EditorApiError`, which the field reports beside itself.
   */
  readonly listAssets: () => Promise<AssetListing>;
  readonly onSetParam: (id: string, field: string, value: JsonValue) => void;
  readonly onResetParam: (id: string, field: string) => void;
  /** Wait for this field's target to be pointed at in the viewport or the tree. */
  readonly onPickTarget: (
    id: string,
    field: string,
    types: readonly string[],
  ) => void;
  /** Stop waiting. The field keeps whatever it held. */
  readonly onCancelPick: () => void;
  readonly onResetPlacement: (id: string) => void;
  readonly onSetKey: (id: string, key: string | null) => void;
  /** The layers the open level may put a placement on. Empty hides the control. */
  readonly layerChoices: () => readonly LayerChoice[];
  /** Whether the layer a placement draws on keys its own draw order. */
  readonly layerSorts: (layer: string | undefined) => boolean;
  readonly onSetLayer: (id: string, layer: string | null) => void;
  readonly onOrder: (id: string, direction: OrderDirection) => void;
}

/**
 * What exactly one selected placement holds that varies in size: its setup
 * parameters, anything preparation reported about it, and the key a game
 * looks it up by. Its name and its pose are on the control bar under the
 * toolbar instead — those are six fixed numbers, and a bar holds them.
 *
 * Zero or several selected placements get an explicit empty state rather than
 * a form that half works. The parameter controls come from the type's field
 * descriptions — plain data the project coordinator derives from the catalog
 * — so what is rendered is what the declaration declares, and the placement's
 * authored values fill it in. The key is document data, so it renders for a
 * placement whose type the catalog does not hold.
 *
 * It subscribes to the whole state rather than to slices of it: it reads the
 * document, the selection and every diagnostic.
 */
export function Inspector(props: InspectorProps): React.JSX.Element {
  const state = useEditorState(props.store);
  const selected = [...state.selection];
  const placement =
    selected.length === 1
      ? state.document.entities.find((one) => one.id === selected[0])
      : undefined;

  return (
    <Panel title="Inspector" testId="inspector">
      {placement ? (
        // Keyed by id so a field being edited does not carry its draft over to
        // the next selected placement, and a pending confirmation is dropped.
        <PlacementInspector
          key={placement.id}
          {...props}
          state={state}
          placement={placement}
        />
      ) : (
        <PanelEmpty testId="inspector-empty">
          {selected.length === 0
            ? "Nothing selected"
            : `${String(selected.length)} placements selected`}
        </PanelEmpty>
      )}
    </Panel>
  );
}

/** What every part below the panel takes: the props, the state, the subject. */
type PlacementProps = InspectorProps & {
  readonly state: EditorState;
  readonly placement: LevelPlacement;
};

/** Level diagnostic codes that authored defaults can repair. */
const REPAIRABLE = new Set<EditorDiagnostic["code"]>([
  "migration-failed",
  "parameter-invalid",
]);

function PlacementInspector(props: PlacementProps): React.JSX.Element {
  const { placement, editable } = props;
  const type = props.inspectable(placement.type);
  const fields = type?.fields ?? [];
  const fieldNames = new Set(fields.map((field) => field.name));
  const [confirming, setConfirming] = useState(false);

  const diagnostics = [...props.state.diagnostics.values()]
    .flat()
    .filter((diagnostic) => diagnostic.placementId === placement.id);
  const atField = (name: string): EditorDiagnostic[] =>
    diagnostics.filter((diagnostic) => diagnostic.path?.[0] === name);
  // Everything not shown beside a rendered field: the placement itself, or a
  // parameter the current declaration has no control for.
  const atPlacement = diagnostics.filter((diagnostic) => {
    const head = diagnostic.path?.[0];
    return head === undefined || !fieldNames.has(head);
  });
  // Only a finding preparation can attribute to authored parameters is
  // evidence that fresh defaults would fix it. An unknown type or a failed
  // asset derivation is not, and a type the catalog lacks has no defaults.
  const repairable =
    type !== undefined &&
    diagnostics.some((diagnostic) => REPAIRABLE.has(diagnostic.code));
  // A confirmation belongs to the offer that opened it. When the finding
  // clears — an edit fixed it, or an undo did — the question is withdrawn,
  // so a later finding starts from the button again rather than from a
  // dialog nobody opened.
  useEffect(() => {
    if (!repairable) setConfirming(false);
  }, [repairable]);

  return (
    <div className="ye-inspector">
      <div className="ye-inspector__title">
        <small className="ye-inspector__type">
          {placement.type}
          {type === undefined ? " — not in the project" : ""}
        </small>
        <small className="ye-inspector__type">{placement.id}</small>
      </div>

      {fields.map((field) => (
        <Field
          key={field.name}
          field={field}
          value={placement.params[field.name]}
          disabled={!editable}
          diagnostics={atField(field.name)}
          listAssets={props.listAssets}
          entities={props.state.document.entities}
          picking={
            props.state.pick?.placementId === placement.id &&
            props.state.pick.field === field.name
          }
          onStartPick={(types) => {
            props.onPickTarget(placement.id, field.name, types);
          }}
          onEndPick={props.onCancelPick}
          onCommit={(value) => {
            props.onSetParam(placement.id, field.name, value);
          }}
          onReset={() => {
            props.onResetParam(placement.id, field.name);
          }}
        />
      ))}

      {atPlacement.length > 0 ? (
        <ul data-testid="placement-diagnostics" className="ye-messages">
          {atPlacement.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${String(index)}`}>
              {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}

      {repairable && !confirming ? (
        <Button
          testId="reset-placement"
          disabled={!editable}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Reset all parameters
        </Button>
      ) : null}
      {repairable && confirming ? (
        <div
          data-testid="reset-placement-confirm"
          role="alertdialog"
          className="ye-confirm"
        >
          <p>
            The authored parameter values of {placement.name ?? placement.id}{" "}
            will be discarded. Every parameter goes back to the default its
            declaration gives it, and the placement is marked as authored
            against the declaration's current version. Undo puts both back.
          </p>
          <div className="ye-confirm__actions">
            <Button
              testId="confirm-reset-placement"
              disabled={!editable}
              onClick={() => {
                setConfirming(false);
                props.onResetPlacement(placement.id);
              }}
            >
              Discard and reset
            </Button>
            <Button
              testId="cancel-reset-placement"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <DrawOrderSection {...props} />
      <KeySection {...props} />
    </div>
  );
}

/** The option that stands for "no authored layer", and its label. */
const NO_LAYER = "default";

/** The four ordering controls, back to front, and what each one is called. */
const ORDER_CONTROLS: readonly {
  direction: OrderDirection;
  label: string;
  testId: string;
}[] = [
  { direction: "back", label: "Send to back", testId: "order-back" },
  { direction: "backward", label: "Backward", testId: "order-backward" },
  { direction: "forward", label: "Forward", testId: "order-forward" },
  { direction: "front", label: "Bring to front", testId: "order-front" },
];

/**
 * What draws on top of what: the layer this placement's visuals join, and
 * where it sits among the placements that share its parent.
 *
 * Both are the same question at two scales. A layer is the coarse one and is
 * offered only when the project declared layers for this level; sibling order
 * is the fine one, and it is what decides draw order inside one layer, since
 * a level's entities are added in document order.
 *
 * Sibling-scoped is the whole promise: a child moves among its siblings and a
 * root among the roots, and neither control ever changes a parent. On a layer
 * that keys its own order the four controls are switched off and say why —
 * reordering the document there would change the file and nothing on screen.
 */
function DrawOrderSection(props: PlacementProps): React.JSX.Element {
  const { placement, editable } = props;
  const choices = props.layerChoices();
  const sorted = props.layerSorts(placement.layer);
  return (
    <div className="ye-section" data-testid="draw-order-section">
      <h4 className="ye-section__title">Draw order</h4>
      {choices.length > 0 ? (
        <label className="ye-field">
          <span className="ye-field__label">Layer</span>
          <Select
            label="Layer"
            testId="placement-layer"
            value={placement.layer ?? NO_LAYER}
            disabled={!editable}
            options={[
              { value: NO_LAYER, label: "Default" },
              ...choices.map((choice) => ({
                value: choice.name,
                label: choice.sorted ? `${choice.name} (sorted)` : choice.name,
              })),
            ]}
            onChange={(value) => {
              props.onSetLayer(placement.id, value === NO_LAYER ? null : value);
            }}
          />
        </label>
      ) : null}
      <div className="ye-section__actions">
        {ORDER_CONTROLS.map((control) => (
          <Button
            key={control.direction}
            testId={control.testId}
            disabled={!editable || sorted}
            onClick={() => {
              props.onOrder(placement.id, control.direction);
            }}
          >
            {control.label}
          </Button>
        ))}
      </div>
      {sorted ? (
        <p className="ye-section__note" data-testid="order-sorted-note">
          This layer sorts what it draws every frame, so the order here would
          change the file and nothing on screen.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The key a game looks the entity up by, last in the panel and in a section
 * of its own — it is the one field here whose value leaves the editor, and
 * changing it breaks every lookup written against the old one.
 *
 * The field asks before it sends. A key another placement already derives
 * makes the level refuse to load, so the reducer refuses the edit too; asking
 * here is what names the placement in the way instead of reporting a failure
 * after the fact.
 */
function KeySection(props: PlacementProps): React.JSX.Element {
  const { placement } = props;
  return (
    <div className="ye-section" data-testid="key-section">
      <h4 className="ye-section__title">In your game</h4>
      <p className="ye-section__note">
        Your game finds this entity by key:{" "}
        <code data-testid="scene-key">{`<namespace>/${derivedSceneKey(placement)}`}</code>
        . Changing it breaks lookups that used the old one.
      </p>
      <TextField
        label="Key"
        testId="placement-key"
        value={placement.key ?? ""}
        placeholder={placement.id}
        disabled={!props.editable}
        reject={(text) => {
          // An empty box takes the key away, and the placement goes back to
          // deriving its id — which another placement's key can already hold.
          const derived = text.trim() === "" ? placement.id : text.trim();
          const holder = sceneKeyHolder(
            props.state.document.entities,
            derived,
            placement.id,
          );
          return holder === undefined
            ? undefined
            : `Placement ${holder.id} already uses that key.`;
        }}
        onCommit={(text) => {
          props.onSetKey(placement.id, trimmedOrNull(text));
        }}
      />
    </div>
  );
}

/**
 * One declared field. The switch is over the kinds the level package can
 * describe; a kind added there without a control here fails to compile
 * rather than rendering nothing.
 */
function Field(props: FieldProps): React.JSX.Element {
  switch (props.field.kind) {
    case "asset":
      return <AssetField {...props} />;
    case "entityRef":
      return <EntityRefField {...props} />;
    case "number":
    case "integer":
      return <NumberField {...props} />;
    case "boolean":
      return <BooleanField {...props} />;
    case "string":
      return <StringField {...props} />;
    case "select":
      return <SelectField {...props} />;
    default: {
      const unhandled: never = props.field.kind;
      throw new Error(`No control for parameter kind ${String(unhandled)}.`);
    }
  }
}

interface FieldProps {
  field: ParamFieldDescription;
  value: unknown;
  disabled: boolean;
  diagnostics: readonly EditorDiagnostic[];
  listAssets: () => Promise<AssetListing>;
  /** The open document's placements, which a reference field picks from. */
  entities: readonly LevelPlacement[];
  /** Whether this field is the one waiting for a target to be pointed at. */
  picking: boolean;
  onStartPick: (types: readonly string[]) => void;
  onEndPick: () => void;
  onCommit: (value: JsonValue) => void;
  onReset: () => void;
}

/** What the asset field has of the project's listing at this moment. */
type AssetOffer =
  | { readonly status: "idle" }
  /** A read in flight, carrying the answer before it so the list never blanks. */
  | { readonly status: "loading"; readonly shown: AssetListing | undefined }
  | { readonly status: "ready"; readonly listing: AssetListing }
  | { readonly status: "failed"; readonly message: string };

/** The rows on screen: the newest answer, kept while the next read runs. */
function shownListing(offer: AssetOffer): AssetListing | undefined {
  if (offer.status === "ready") return offer.listing;
  if (offer.status === "loading") return offer.shown;
  return undefined;
}

/**
 * A project-relative POSIX path, as text, with the project's own files on
 * offer under it. The path is not checked here: preparation reports an invalid
 * one at this field, the preview leaves the placement out, and the document
 * stays editable — a second validation rule in the form would contradict that.
 * Completion offers only paths that exist, which is a different thing from the
 * box refusing one that does not.
 *
 * The listing is re-read every time the list opens, which is what makes "add a
 * sprite to the project, then pick it" work with nothing watching the files.
 * While a re-read is in flight the rows already on screen stay, so the list
 * never blanks.
 */
function AssetField(props: FieldProps): React.JSX.Element {
  const { field } = props;
  const held = typeof props.value === "string" ? props.value : "";
  const invalid = props.diagnostics.length > 0;
  const [offer, setOffer] = useState<AssetOffer>({ status: "idle" });
  // Which read the field is waiting for. An earlier read that finishes after a
  // later one must not put its older answer back on screen.
  const pending = useRef(0);
  const note = assetNote(offer);

  const read = (): void => {
    pending.current += 1;
    const attempt = pending.current;
    setOffer((current) => ({
      status: "loading",
      shown: shownListing(current),
    }));
    props.listAssets().then(
      (listing) => {
        if (attempt === pending.current) setOffer({ status: "ready", listing });
      },
      (error: unknown) => {
        if (attempt === pending.current) {
          setOffer({ status: "failed", message: describeFailure(error) });
        }
      },
    );
  };

  return (
    <div>
      <TextField
        label={field.name}
        testId={`field-${field.name}`}
        value={held}
        disabled={props.disabled}
        invalid={invalid}
        onCommit={props.onCommit}
        completion={{
          values: shownListing(offer)?.paths ?? [],
          onOpen: read,
          ...(note === undefined ? {} : { note }),
        }}
      >
        <Button
          testId={`reset-${field.name}`}
          disabled={props.disabled || held === field.defaultValue}
          title={`Reset to ${String(field.defaultValue)}`}
          onClick={props.onReset}
        >
          Reset
        </Button>
      </TextField>
      <FieldFindings field={field.name} diagnostics={props.diagnostics} />
    </div>
  );
}

/**
 * Another placement in the same level, chosen from the ones whose type the
 * parameter accepts.
 *
 * The held id stays visible whatever the document says about it: a target that
 * has been deleted, or one whose type no longer fits, renders as its own first
 * row rather than blanking the control, so preparation's finding beneath it
 * says what is wrong and one click replaces it. An optional field gets a
 * `Clear` beside the list instead of an empty row in it, because the empty
 * string is the placeholder's and no other string is provably free of
 * collision with an authored id.
 *
 * `Pick` is the other way to set the value: it waits for the target to be
 * clicked in the viewport or in the hierarchy, and a second press stops
 * waiting. Left to right the row reads choose, point, empty.
 */
function EntityRefField(props: FieldProps): React.JSX.Element {
  const { field } = props;
  const held = typeof props.value === "string" ? props.value : "";
  const invalid = props.diagnostics.length > 0;
  const types = field.types ?? [];
  const { options, candidates } = referenceOptions(props.entities, types, held);

  return (
    <div>
      <div className="ye-field">
        <span className="ye-field__label">{field.name}</span>
        <Select
          label={field.name}
          testId={`field-${field.name}`}
          value={held}
          placeholder="Choose a target"
          invalid={invalid}
          disabled={props.disabled || candidates === 0}
          options={options}
          onChange={(value) => {
            // Choosing a row is a legitimate way to finish, so the list stays
            // live while the field waits.
            if (props.picking) props.onEndPick();
            props.onCommit(value);
          }}
        />
        <Button
          testId={`pick-${field.name}`}
          pressed={props.picking}
          disabled={props.disabled || candidates === 0}
          title="Choose this target by clicking it in the level"
          onClick={() => {
            if (props.picking) props.onEndPick();
            else props.onStartPick(types);
          }}
        >
          Pick
        </Button>
        <ClearButton
          field={field}
          disabled={props.disabled || held === ""}
          onClear={props.onCommit}
        />
      </div>
      {props.picking ? (
        <p
          className="ye-section__note"
          data-testid={`field-${field.name}-picking`}
        >
          Click the target in the level or in the hierarchy. Esc cancels.
        </p>
      ) : null}
      {candidates === 0 ? (
        <p
          className="ye-section__note"
          data-testid={`field-${field.name}-note`}
        >
          No {types.join(" or ")} in this level.
        </p>
      ) : null}
      <FieldFindings field={field.name} diagnostics={props.diagnostics} />
    </div>
  );
}

/**
 * A number, in the box the control bar's transform numbers use: Up and Down
 * step it, dragging the label scrubs it, and text this field cannot take stays
 * in the box with the reason beside it instead of being written.
 *
 * A whole number shares the control and differs in two things: the ladder is
 * whole, and a fraction is refused rather than rounded, because a fraction in
 * the file is a mistake and not a number to correct silently.
 */
function NumberField(props: FieldProps): React.JSX.Element {
  const { field } = props;
  const held = numberText(props.value);
  return (
    <div>
      <TextField
        label={field.name}
        testId={`field-${field.name}`}
        value={held}
        numeric
        placeholder={field.optional === true ? EMPTY_LABEL : undefined}
        disabled={props.disabled}
        invalid={props.diagnostics.length > 0}
        reject={(text) => refusedNumber(text, field)}
        stepping={{
          step: (text, intent) => steppedNumber(text, field, intent),
        }}
        onCommit={(text) => {
          props.onCommit(Number(text.trim()));
        }}
      >
        <ClearButton
          field={field}
          disabled={props.disabled || props.value === null}
          onClear={props.onCommit}
        />
      </TextField>
      <FieldFindings field={field.name} diagnostics={props.diagnostics} />
    </div>
  );
}

/**
 * A switch. An optional one has three states rather than two, so a box holding
 * nothing draws as mixed — neither on nor off — and Clear is how it gets back
 * there once something has been chosen.
 */
function BooleanField(props: FieldProps): React.JSX.Element {
  const { field } = props;
  const held = typeof props.value === "boolean" ? props.value : undefined;
  return (
    <div>
      <div className="ye-field">
        <span className="ye-field__label">{field.name}</span>
        <Checkbox
          label={field.name}
          testId={`field-${field.name}`}
          checked={held === true}
          mixed={held === undefined}
          disabled={props.disabled}
          invalid={props.diagnostics.length > 0}
          onChange={props.onCommit}
        />
        <ClearButton
          field={field}
          disabled={props.disabled || props.value === null}
          onClear={props.onCommit}
        />
      </div>
      <FieldFindings field={field.name} diagnostics={props.diagnostics} />
    </div>
  );
}

/**
 * Text, committed as typed. The empty string is a value here, so an optional
 * field is emptied by Clear rather than by deleting what is in the box.
 */
function StringField(props: FieldProps): React.JSX.Element {
  const { field } = props;
  const held = typeof props.value === "string" ? props.value : "";
  // A string field is the one place the empty box is ambiguous: text of no
  // length and nothing at all both leave it blank. The label shows for
  // nothing at all, so the two read apart without a second control.
  const empty = field.optional === true && props.value === null;
  return (
    <div>
      <TextField
        label={field.name}
        testId={`field-${field.name}`}
        value={held}
        multiline={field.multiline === true}
        placeholder={empty ? EMPTY_LABEL : undefined}
        disabled={props.disabled}
        invalid={props.diagnostics.length > 0}
        onCommit={props.onCommit}
      >
        <ClearButton
          field={field}
          disabled={props.disabled || props.value === null}
          onClear={props.onCommit}
        />
      </TextField>
      <FieldFindings field={field.name} diagnostics={props.diagnostics} />
    </div>
  );
}

/**
 * One of the values the declaration lists.
 *
 * A held value the list no longer offers keeps its own first row, the way a
 * reference keeps a target that has gone: the declaration changed under a
 * level that was authored against it, and the finding beneath says so while
 * one click replaces it.
 */
function SelectField(props: FieldProps): React.JSX.Element {
  const { field } = props;
  const held = typeof props.value === "string" ? props.value : "";
  const values = field.options ?? [];
  const rows = values.map((value) => ({ value, label: value }));
  if (held !== "" && !values.includes(held)) {
    rows.unshift({ value: held, label: `Not offered: ${held}` });
  }
  return (
    <div>
      <div className="ye-field">
        <span className="ye-field__label">{field.name}</span>
        <Select
          label={field.name}
          testId={`field-${field.name}`}
          value={held}
          placeholder={EMPTY_LABEL}
          invalid={props.diagnostics.length > 0}
          disabled={props.disabled || rows.length === 0}
          options={rows}
          onChange={props.onCommit}
        />
        <ClearButton
          field={field}
          disabled={props.disabled || props.value === null}
          onClear={props.onCommit}
        />
      </div>
      <FieldFindings field={field.name} diagnostics={props.diagnostics} />
    </div>
  );
}

/**
 * What every control shows in place of a value an optional field does not
 * hold. One word across the box, the text area and the dropdown, so nothing
 * chosen reads the same wherever it is met.
 */
const EMPTY_LABEL = "None";

/**
 * Empties an optional field. A required field has no such value, so it gets no
 * button at all.
 */
function ClearButton(props: {
  readonly field: ParamFieldDescription;
  readonly disabled: boolean;
  readonly onClear: (value: null) => void;
}): React.JSX.Element | null {
  if (props.field.optional !== true) return null;
  return (
    <Button
      testId={`clear-${props.field.name}`}
      disabled={props.disabled}
      onClick={() => {
        props.onClear(null);
      }}
    >
      Clear
    </Button>
  );
}

/** What preparation found about one field, under the control it belongs to. */
function FieldFindings(props: {
  readonly field: string;
  readonly diagnostics: readonly EditorDiagnostic[];
}): React.JSX.Element | null {
  if (props.diagnostics.length === 0) return null;
  return (
    <ul
      data-testid={`field-${props.field}-diagnostics`}
      className="ye-messages ye-messages--error"
    >
      {props.diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic.code}-${String(index)}`}>
          {diagnostic.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * What a number box shows. A value of another type is shown as it was
 * authored, so the finding under the box is about something visible.
 */
function numberText(value: unknown): string {
  if (typeof value === "number") return String(rounded(value));
  return typeof value === "string" ? value : "";
}

/**
 * Why the typed text is not a number this field takes, if it is not. A refused
 * entry keeps its text and renders the reason under the row; nothing is sent.
 */
function refusedNumber(
  text: string,
  field: ParamFieldDescription,
): string | undefined {
  const typed = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(typed)) return "Type a number.";
  if (field.kind === "integer" && !Number.isInteger(typed)) {
    return "Type a whole number.";
  }
  if (field.min !== undefined && typed < field.min) {
    return `Type ${String(field.min)} or more.`;
  }
  if (field.max !== undefined && typed > field.max) {
    return `Type ${String(field.max)} or less.`;
  }
  return undefined;
}

/**
 * The number one arrow press or one scrub step produces, held inside the range
 * the field declared, or `undefined` when the box shows nothing to step from.
 *
 * `Shift` takes ten of the declared step and `Alt` a tenth of it. A whole
 * number has no tenth, so there `Alt` moves by one like an ordinary press.
 */
function steppedNumber(
  text: string,
  field: ParamFieldDescription,
  intent: StepIntent,
): string | undefined {
  const from = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(from)) return undefined;
  const whole = field.kind === "integer";
  const unit = whole ? 1 : (field.step ?? 1);
  const by = intent.coarse
    ? unit * 10
    : intent.fine && !whole
      ? unit / 10
      : unit;
  let next = rounded(from + by * intent.direction);
  if (field.min !== undefined) next = Math.max(next, field.min);
  if (field.max !== undefined) next = Math.min(next, field.max);
  return String(next);
}

/**
 * The rows a reference field offers: every placement of an accepted type in
 * document order, plus the held id when the document cannot account for it.
 *
 * A placement is labelled by whatever a person would recognize it as — its
 * name, else its scene key, else its id — and two rows that would read the
 * same both get their id appended. The placement being edited is offered like
 * any other: a self-reference is a one-placement cycle, and the loader
 * resolves cycles.
 */
function referenceOptions(
  entities: readonly LevelPlacement[],
  types: readonly string[],
  held: string,
): { readonly options: readonly SelectOption[]; readonly candidates: number } {
  const accepted = new Set(types);
  const matching = entities.filter((one) => accepted.has(one.type));
  const counts = new Map<string, number>();
  for (const one of matching) {
    const label = labelOf(one);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const options = matching.map((one) => {
    const label = labelOf(one);
    return {
      value: one.id,
      label: (counts.get(label) ?? 0) > 1 ? `${label} (${one.id})` : label,
    };
  });
  if (held !== "" && !matching.some((one) => one.id === held)) {
    const wrongType = entities.find((one) => one.id === held);
    options.unshift({
      value: held,
      label:
        wrongType === undefined
          ? `Missing: ${held}`
          : `Wrong type: ${labelOf(wrongType)}`,
    });
  }
  return { options, candidates: matching.length };
}

function labelOf(placement: LevelPlacement): string {
  return placement.name ?? placement.key ?? placement.id;
}

/**
 * What the list says about itself while it is being read, when it could not
 * be, and when what the project configured leaves it empty or cut short.
 */
function assetNote(offer: AssetOffer): string | undefined {
  switch (offer.status) {
    case "idle":
      return undefined;
    case "loading":
      return offer.shown === undefined
        ? "Reading the project's assets…"
        : "Checking for new files…";
    case "failed":
      return `Could not read the project's assets: ${offer.message}`;
    case "ready":
      if (offer.listing.paths.length === 0) {
        // True of a project that configured no globs and of one whose globs
        // match nothing; the listing does not say which, and both are fixed in
        // the same file.
        return 'No files matched. Check the "assets" globs in editor/config.ts.';
      }
      return offer.listing.truncated
        ? `Showing the first ${String(offer.listing.paths.length)}. ` +
            'Narrow the "assets" globs in editor/config.ts.'
        : undefined;
  }
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
