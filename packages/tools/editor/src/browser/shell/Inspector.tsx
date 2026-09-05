import type {
  ParamFieldDescription,
  ParamKindName,
  ParamValueDescription,
} from "@yagejs/level";
import type { JsonValue, LevelPlacement } from "@yagejs/level/document";
import { useEffect, useRef, useState } from "react";
import {
  derivedSceneKey,
  equalJson,
  sceneKeyHolder,
} from "../../shared/commands/index.js";
import type { EditorDiagnostic } from "../../shared/diagnostics/index.js";
import type { AssetListing } from "../../shared/protocol/index.js";
import {
  draggedValue,
  placementById,
  selectionRoots,
  sharedParent,
  valueAt,
  type OrderDirection,
} from "../commands/index.js";
import type { LayerChoice } from "../layers.js";
import type { InspectableType } from "../project/index.js";
import type { EditorState, EditorStore } from "../store/index.js";
import { Panel, PanelEmpty } from "./Panel.js";
import type { SelectOption, StepIntent } from "./controls.js";
import {
  Button,
  Checkbox,
  MIXED_LABEL,
  Select,
  TextField,
  isMixed,
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
  /**
   * Set one value inside a placement's parameters. The path is measured from
   * the parameter object: one field, or a member or an element inside it.
   */
  readonly onSetParam: (
    ids: readonly string[],
    path: readonly string[],
    value: JsonValue,
  ) => void;
  readonly onResetParam: (
    ids: readonly string[],
    path: readonly string[],
  ) => void;
  /** Wait for this field's target to be pointed at in the viewport or the tree. */
  readonly onPickTarget: (
    id: string,
    field: string,
    types: readonly string[],
  ) => void;
  /** Stop waiting. The field keeps whatever it held. */
  readonly onCancelPick: () => void;
  readonly onResetPlacement: (ids: readonly string[]) => void;
  readonly onSetKey: (id: string, key: string | null) => void;
  /** Whether the placements start their life in the game switched on. */
  readonly onSetActive: (ids: readonly string[], active: boolean) => void;
  /** The layers the open level may put a placement on. Empty hides the control. */
  readonly layerChoices: () => readonly LayerChoice[];
  /** Whether the layer a placement draws on keys its own draw order. */
  readonly layerSorts: (layer: string | undefined) => boolean;
  readonly onSetLayer: (ids: readonly string[], layer: string | null) => void;
  readonly onOrder: (ids: readonly string[], direction: OrderDirection) => void;
}

/**
 * What the selected placements hold that varies in size: their setup
 * parameters, anything preparation reported about them, whether they start
 * active, and the key a game looks one up by. A name and a pose are on the
 * control bar under the toolbar instead — those are six fixed numbers, and a
 * bar holds them.
 *
 * Several selected placements get the same panel over all of them: a control
 * shows the value they agree on, or `Mixed`, and one edit writes to every one
 * of them as a single command and a single undo step. Only what cannot be
 * shared stays with one placement — a name, a key and the findings about a
 * particular placement.
 *
 * The parameter controls come from the type's field descriptions — plain data
 * the project coordinator derives from the catalog — so what is rendered is
 * what the declaration declares, and the placements' authored values fill it
 * in. The key is document data, so it renders for a placement whose type the
 * catalog does not hold.
 *
 * It subscribes to the whole state rather than to slices of it: it reads the
 * document, the selection and every diagnostic.
 */
export function Inspector(props: InspectorProps): React.JSX.Element {
  const state = useEditorState(props.store);
  const byId = placementById(state.document);
  const placements = [...state.selection]
    .map((id) => byId.get(id))
    .filter((one): one is LevelPlacement => one !== undefined);

  return (
    <Panel title="Inspector" testId="inspector">
      {placements.length === 0 ? (
        <PanelEmpty testId="inspector-empty">Nothing selected</PanelEmpty>
      ) : (
        // Keyed by the selection so a field being edited does not carry its
        // draft over to the next one, and a pending confirmation is dropped.
        <PlacementInspector
          key={placements.map((one) => one.id).join(" ")}
          {...props}
          state={state}
          placements={placements}
        />
      )}
    </Panel>
  );
}

/** What every part below the panel takes: the props, the state, the subjects. */
type PlacementProps = InspectorProps & {
  readonly state: EditorState;
  /** At least one, in selection order. */
  readonly placements: readonly LevelPlacement[];
};

/** The one placement a section that cannot be shared is about, if there is one. */
function only(
  placements: readonly LevelPlacement[],
): LevelPlacement | undefined {
  return placements.length === 1 ? placements[0] : undefined;
}

/** Level diagnostic codes that authored defaults can repair. */
const REPAIRABLE = new Set<EditorDiagnostic["code"]>([
  "migration-failed",
  "parameter-invalid",
]);

function PlacementInspector(props: PlacementProps): React.JSX.Element {
  const { placements, editable } = props;
  const ids = placements.map((one) => one.id);
  const single = only(placements);
  const types = placements.map((one) => props.inspectable(one.type));
  const fields = sharedFields(types);
  // A type the project does not hold declares nothing, so a selection of only
  // those has nothing to share and the line above already says why.
  const known = types.some((one) => one !== undefined);
  const fieldNames = new Set(fields.map((field) => field.name));
  const [confirming, setConfirming] = useState(false);

  const selected = new Set(ids);
  const diagnostics = [...props.state.diagnostics.values()]
    .flat()
    .filter(
      (diagnostic) =>
        diagnostic.placementId !== undefined &&
        selected.has(diagnostic.placementId),
    );
  const atField = (name: string): EditorDiagnostic[] =>
    single === undefined
      ? []
      : diagnostics.filter((diagnostic) => diagnostic.path?.[0] === name);
  // Everything not shown beside a rendered field: the placement itself, or a
  // parameter the current declaration has no control for. A finding is about
  // one placement, so a selection of several lists none — the Problems panel
  // is where findings are read with the placement they belong to.
  const atPlacement =
    single === undefined
      ? []
      : diagnostics.filter((diagnostic) => {
          const head = diagnostic.path?.[0];
          return head === undefined || !fieldNames.has(head);
        });
  // Only a finding preparation can attribute to authored parameters is
  // evidence that fresh defaults would fix it. An unknown type or a failed
  // asset derivation is not, and a type the catalog lacks has no defaults.
  const repairable = placements.some(
    (placement) =>
      props.inspectable(placement.type) !== undefined &&
      diagnostics.some(
        (diagnostic) =>
          diagnostic.placementId === placement.id &&
          REPAIRABLE.has(diagnostic.code),
      ),
  );
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
        <small className="ye-inspector__type">{typeLine(props)}</small>
        <small className="ye-inspector__type">
          {single === undefined
            ? `${String(placements.length)} placements`
            : single.id}
        </small>
      </div>

      {fields.map((field) => (
        <Field
          key={field.name}
          description={field}
          label={field.name}
          path={[field.name]}
          values={placements.map((placement) =>
            liveValue(props.state, placement, [field.name]),
          )}
          disabled={!editable}
          diagnostics={atField(field.name)}
          listAssets={props.listAssets}
          entities={props.state.document.entities}
          picking={
            single !== undefined &&
            props.state.pick?.placementId === single.id &&
            props.state.pick.field === field.name
          }
          onStartPick={
            single === undefined
              ? undefined
              : (types) => {
                  props.onPickTarget(single.id, field.name, types);
                }
          }
          onEndPick={props.onCancelPick}
          onCommit={(path, value) => {
            props.onSetParam(ids, path, value);
          }}
          onReset={(path) => {
            props.onResetParam(ids, path);
          }}
        />
      ))}

      {fields.length === 0 && placements.length > 1 && known ? (
        <p className="ye-section__note" data-testid="no-shared-params">
          The selected placements share no parameters.
        </p>
      ) : null}

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
            The authored parameter values of{" "}
            {single === undefined
              ? `${String(placements.length)} placements`
              : (single.name ?? single.id)}{" "}
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
                props.onResetPlacement(ids);
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
      <GameSection {...props} />
    </div>
  );
}

/**
 * What the panel is about: the one type every selected placement has, or how
 * many types they are between them.
 */
function typeLine(props: PlacementProps): string {
  const types = new Set(props.placements.map((placement) => placement.type));
  const [one] = [...types];
  if (types.size !== 1 || one === undefined) {
    return `${String(types.size)} types`;
  }
  return props.inspectable(one) === undefined
    ? `${one} — not in the project`
    : one;
}

/**
 * The parameter controls a selection gets: every field of the one type they
 * share, or — across several types — the fields declared identically by all of
 * them.
 *
 * Identical means the whole description: the same name, the same kind, and the
 * same bounds, options and members. A `count` bounded at 10 in one type and at
 * 100 in another is not one control, because a value the panel offers has to
 * be a value every selected placement accepts. A type the catalog does not
 * hold declares nothing, so a selection holding one shares nothing.
 */
function sharedFields(
  types: readonly (InspectableType | undefined)[],
): readonly ParamFieldDescription[] {
  const [first, ...rest] = types;
  if (first === undefined) return [];
  if (rest.length === 0) return first.fields;
  return first.fields.filter((field) =>
    rest.every((other) =>
      other?.fields.some((candidate) => sameDescription(candidate, field)),
    ),
  );
}

/** Whether two declarations describe the same control over the same values. */
function sameDescription(
  left: ParamValueDescription,
  right: ParamValueDescription,
): boolean {
  return canonical(left) === canonical(right);
}

/**
 * A description as text, with its members in a fixed order and the ones it
 * does not carry left out — so two declarations written in different orders
 * still read as the same control.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, member]) => `${JSON.stringify(name)}:${canonical(member)}`);
  return `{${entries.join(",")}}`;
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
 * What draws on top of what: the layer these placements' visuals join, and
 * where they sit among the placements that share their parent.
 *
 * Both are the same question at two scales. A layer is the coarse one and is
 * offered only when the project declared layers for this level; sibling order
 * is the fine one, and it is what decides draw order inside one layer, since
 * a level's entities are added in document order.
 *
 * Sibling-scoped is the whole promise: a child moves among its siblings and a
 * root among the roots, and neither control ever changes a parent. So the four
 * controls need one group to move within: a selection whose outermost members
 * are under different parents has none, and they are switched off and say so.
 * They are switched off on a layer that keys its own order too — reordering
 * the document there would change the file and nothing on screen.
 */
function DrawOrderSection(props: PlacementProps): React.JSX.Element {
  const { placements, editable } = props;
  const ids = placements.map((one) => one.id);
  const choices = props.layerChoices();
  const sorted = placements.some((one) => props.layerSorts(one.layer));
  const layers = placements.map((one) => one.layer ?? NO_LAYER);
  const mixed = isMixed(layers);
  // The controls move the outermost of what is selected, so that is what has
  // to share a parent; a selected child already travels with its parent.
  const spread =
    sharedParent(
      props.state.document,
      selectionRoots(props.state.document, ids),
    ) === undefined;
  return (
    <div className="ye-section" data-testid="draw-order-section">
      <h4 className="ye-section__title">Draw order</h4>
      {choices.length > 0 ? (
        <label className="ye-field">
          <span className="ye-field__label">Layer</span>
          <Select
            label="Layer"
            testId="placement-layer"
            value={mixed ? "" : (layers[0] as string)}
            placeholder={MIXED_LABEL}
            disabled={!editable}
            options={[
              { value: NO_LAYER, label: "Default" },
              ...choices.map((choice) => ({
                value: choice.name,
                label: choice.sorted ? `${choice.name} (sorted)` : choice.name,
              })),
            ]}
            onChange={(value) => {
              props.onSetLayer(ids, value === NO_LAYER ? null : value);
            }}
          />
        </label>
      ) : null}
      <div className="ye-section__actions">
        {ORDER_CONTROLS.map((control) => (
          <Button
            key={control.direction}
            testId={control.testId}
            disabled={!editable || sorted || spread}
            onClick={() => {
              props.onOrder(ids, control.direction);
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
      {spread && !sorted ? (
        <p className="ye-section__note" data-testid="order-spread-note">
          The selected placements have different parents.
        </p>
      ) : null}
    </div>
  );
}

/**
 * What the running game makes of these placements: whether each one starts
 * switched on, and the key a game looks one up by.
 *
 * `active` is authored state and is in the file: a placement authored inactive
 * is created and then disabled, so it takes no update and draws nothing until
 * game code wakes it. Hiding a placement while working is a different thing
 * and lives in the hierarchy.
 *
 * The key comes last and is for one placement at a time — a shared key cannot
 * exist, since two placements deriving one scene key make the level refuse to
 * load. The field asks before it sends: the reducer refuses such an edit, and
 * asking here is what names the placement in the way instead of reporting a
 * failure after the fact.
 */
function GameSection(props: PlacementProps): React.JSX.Element {
  const { placements } = props;
  const single = only(placements);
  const active = placements.map((one) => one.active);
  const mixed = isMixed(active);
  return (
    <div className="ye-section" data-testid="game-section">
      <h4 className="ye-section__title">In your game</h4>
      <div className="ye-field">
        <span className="ye-field__label">Active in game</span>
        <Checkbox
          label="Active in game"
          testId="placement-active"
          checked={!mixed && active[0] === true}
          mixed={mixed}
          disabled={!props.editable}
          onChange={(checked) => {
            props.onSetActive(
              placements.map((one) => one.id),
              checked,
            );
          }}
        />
      </div>
      {single === undefined ? null : (
        <>
          <p className="ye-section__note">
            Your game finds this entity by key:{" "}
            <code data-testid="scene-key">{`<namespace>/${derivedSceneKey(single)}`}</code>
            . Changing it breaks lookups that used the old one.
          </p>
          <TextField
            label="Key"
            testId="placement-key"
            value={single.key ?? ""}
            placeholder={single.id}
            disabled={!props.editable}
            reject={(text) => {
              // An empty box takes the key away, and the placement goes back
              // to deriving its id — which another placement's key can already
              // hold.
              const derived = text.trim() === "" ? single.id : text.trim();
              const holder = sceneKeyHolder(
                props.state.document.entities,
                derived,
                single.id,
              );
              return holder === undefined
                ? undefined
                : `Placement ${holder.id} already uses that key.`;
            }}
            onCommit={(text) => {
              props.onSetKey(single.id, trimmedOrNull(text));
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * One declared value: a whole field, a member of an object, or one element of
 * a list. The switch is over the kinds the level package can describe; a kind
 * added there without a control here fails to compile rather than rendering
 * nothing.
 *
 * `kind` is flat at every depth, so a member and an element reach this switch
 * exactly as a top-level field does.
 */
function Field(props: FieldProps): React.JSX.Element {
  switch (props.description.kind) {
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
    case "vec2":
    case "point":
      return <TupleField {...props} />;
    case "object":
      return <ObjectField {...props} />;
    case "array":
      return <ListField {...props} />;
    case "json":
      return <JsonField {...props} />;
    case "custom":
      return <CustomField {...props} />;
    case "color":
      return <ColorField {...props} />;
    default: {
      const unhandled: never = props.description.kind;
      throw new Error(`No control for parameter kind ${String(unhandled)}.`);
    }
  }
}

/**
 * A value the game decodes, edited with the control its declaration named. The
 * document holds the JSON that control produces, so nothing here knows what
 * the game makes of it.
 */
function CustomField(props: FieldProps): React.JSX.Element {
  switch (props.description.editor) {
    case "number":
    case "integer":
      return <NumberField {...props} />;
    case "boolean":
      return <BooleanField {...props} />;
    case "string":
      return <StringField {...props} />;
    case "select":
      return <SelectField {...props} />;
    case "json":
    case undefined:
      return <JsonField {...props} />;
    default: {
      const unhandled: never = props.description.editor;
      throw new Error(`No control for parameter editor ${String(unhandled)}.`);
    }
  }
}

interface FieldProps {
  /** What this value is, and which control it needs. */
  description: ParamValueDescription;
  /** The word beside the control: a field or member name, or a position. */
  label: string;
  /** Where the value sits inside the placement's parameters. */
  path: readonly string[];
  /**
   * What each selected placement holds here, in selection order. One entry for
   * one placement; several that differ are what a control draws as `Mixed`.
   */
  values: readonly unknown[];
  disabled: boolean;
  diagnostics: readonly EditorDiagnostic[];
  listAssets: () => Promise<AssetListing>;
  /** The open document's placements, which a reference field picks from. */
  entities: readonly LevelPlacement[];
  /** Whether this field is the one waiting for a target to be pointed at. */
  picking: boolean;
  /**
   * Wait for a target to be pointed at. Absent for several selected
   * placements: the wait belongs to one field of one placement, and the
   * dropdown is how a selection chooses a target.
   */
  onStartPick?: ((types: readonly string[]) => void) | undefined;
  onEndPick: () => void;
  onCommit: (path: readonly string[], value: JsonValue) => void;
  onReset: (path: readonly string[]) => void;
}

/** The one value the selected placements hold here, or the fact that they differ. */
interface SharedValue {
  /** The first placement's value, which is every placement's when not mixed. */
  readonly value: unknown;
  readonly mixed: boolean;
}

/**
 * What a control draws from: one value, or `Mixed`.
 *
 * A value is compared by its contents, so two placements holding equal objects
 * agree. A value a placement does not hold at all differs from every value one
 * does, which is what makes an emptied optional field read as mixed beside a
 * filled one.
 */
function sharedValue(values: readonly unknown[]): SharedValue {
  return { value: values[0], mixed: isMixed(values, sameValue) };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return equalJson(left as JsonValue, right as JsonValue);
}

/**
 * What a control is called in the markup, and what a finding under it is keyed
 * by. A top-level field is its own name, and a value inside one is the path
 * that reaches it.
 */
function fieldKey(path: readonly string[]): string {
  return path.join(".");
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
  const { description } = props;
  const key = fieldKey(props.path);
  const { value, mixed } = sharedValue(props.values);
  const held = mixed || typeof value !== "string" ? "" : value;
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
        label={props.label}
        testId={`field-${key}`}
        value={held}
        placeholder={mixed ? MIXED_LABEL : undefined}
        disabled={props.disabled}
        invalid={invalid}
        onCommit={(text) => {
          props.onCommit(props.path, text);
        }}
        completion={{
          values: shownListing(offer)?.paths ?? [],
          onOpen: read,
          ...(note === undefined ? {} : { note }),
        }}
      >
        <Button
          testId={`reset-${key}`}
          disabled={
            props.disabled || (!mixed && held === description.defaultValue)
          }
          title={`Reset to ${String(description.defaultValue)}`}
          onClick={() => {
            props.onReset(props.path);
          }}
        >
          Reset
        </Button>
      </TextField>
      <FieldFindings field={key} diagnostics={props.diagnostics} />
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
  const { description } = props;
  const key = fieldKey(props.path);
  const { value, mixed } = sharedValue(props.values);
  const held = mixed || typeof value !== "string" ? "" : value;
  const invalid = props.diagnostics.length > 0;
  const types = description.types ?? [];
  const { options, candidates } = referenceOptions(props.entities, types, held);
  const onStartPick = props.onStartPick;

  return (
    <div>
      <div className="ye-field">
        <span className="ye-field__label">{props.label}</span>
        <Select
          label={props.label}
          testId={`field-${key}`}
          value={held}
          placeholder={mixed ? MIXED_LABEL : "Choose a target"}
          invalid={invalid}
          disabled={props.disabled || candidates === 0}
          options={options}
          onChange={(value) => {
            // Choosing a row is a legitimate way to finish, so the list stays
            // live while the field waits.
            if (props.picking) props.onEndPick();
            props.onCommit(props.path, value);
          }}
        />
        {onStartPick === undefined ? null : (
          <Button
            testId={`pick-${key}`}
            pressed={props.picking}
            disabled={props.disabled || candidates === 0}
            title="Choose this target by clicking it in the level"
            onClick={() => {
              if (props.picking) props.onEndPick();
              else onStartPick(types);
            }}
          >
            Pick
          </Button>
        )}
        <ClearButton {...props} />
      </div>
      {props.picking ? (
        <p className="ye-section__note" data-testid={`field-${key}-picking`}>
          Click the target in the level or in the hierarchy. Esc cancels.
        </p>
      ) : null}
      {candidates === 0 ? (
        <p className="ye-section__note" data-testid={`field-${key}-note`}>
          No {types.join(" or ")} in this level.
        </p>
      ) : null}
      <FieldFindings field={key} diagnostics={props.diagnostics} />
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
  const { description } = props;
  const key = fieldKey(props.path);
  const { value, mixed } = sharedValue(props.values);
  const held = mixed ? "" : numberText(value);
  return (
    <div>
      <TextField
        label={props.label}
        testId={`field-${key}`}
        value={held}
        numeric
        placeholder={emptyLabel(mixed, description)}
        disabled={props.disabled}
        invalid={props.diagnostics.length > 0}
        reject={(text) => refusedNumber(text, description)}
        stepping={{
          step: (text, intent) => steppedNumber(text, description, intent),
        }}
        onCommit={(text) => {
          props.onCommit(props.path, Number(text.trim()));
        }}
      >
        <ClearButton {...props} />
      </TextField>
      <FieldFindings field={key} diagnostics={props.diagnostics} />
    </div>
  );
}

/**
 * A switch. An optional one has three states rather than two, so a box holding
 * nothing draws as mixed — neither on nor off — and Clear is how it gets back
 * there once something has been chosen. Selected placements that disagree draw
 * the same way, for the same reason: neither state is the one they are in.
 */
function BooleanField(props: FieldProps): React.JSX.Element {
  const key = fieldKey(props.path);
  const { value, mixed } = sharedValue(props.values);
  const held = typeof value === "boolean" ? value : undefined;
  return (
    <div>
      <div className="ye-field">
        <span className="ye-field__label">{props.label}</span>
        <Checkbox
          label={props.label}
          testId={`field-${key}`}
          checked={!mixed && held === true}
          mixed={mixed || held === undefined}
          disabled={props.disabled}
          invalid={props.diagnostics.length > 0}
          onChange={(checked) => {
            props.onCommit(props.path, checked);
          }}
        />
        <ClearButton {...props} />
      </div>
      <FieldFindings field={key} diagnostics={props.diagnostics} />
    </div>
  );
}

/**
 * Text, committed as typed. The empty string is a value here, so an optional
 * field is emptied by Clear rather than by deleting what is in the box.
 */
function StringField(props: FieldProps): React.JSX.Element {
  const { description } = props;
  const key = fieldKey(props.path);
  const { value, mixed } = sharedValue(props.values);
  const held = mixed || typeof value !== "string" ? "" : value;
  // A string field is the one place the empty box is ambiguous: text of no
  // length and nothing at all both leave it blank. The label shows for
  // nothing at all, so the two read apart without a second control.
  const empty = description.optional === true && value === null;
  return (
    <div>
      <TextField
        label={props.label}
        testId={`field-${key}`}
        value={held}
        multiline={description.multiline === true}
        placeholder={mixed ? MIXED_LABEL : empty ? EMPTY_LABEL : undefined}
        disabled={props.disabled}
        invalid={props.diagnostics.length > 0}
        onCommit={(text) => {
          props.onCommit(props.path, text);
        }}
      >
        <ClearButton {...props} />
      </TextField>
      <FieldFindings field={key} diagnostics={props.diagnostics} />
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
  const { description } = props;
  const key = fieldKey(props.path);
  const shared = sharedValue(props.values);
  const held =
    shared.mixed || typeof shared.value !== "string" ? "" : shared.value;
  const values = description.options ?? [];
  const rows = values.map((value) => ({ value, label: value }));
  if (held !== "" && !values.includes(held)) {
    rows.unshift({ value: held, label: `Not offered: ${held}` });
  }
  return (
    <div>
      <div className="ye-field">
        <span className="ye-field__label">{props.label}</span>
        <Select
          label={props.label}
          testId={`field-${key}`}
          value={held}
          placeholder={shared.mixed ? MIXED_LABEL : EMPTY_LABEL}
          invalid={props.diagnostics.length > 0}
          disabled={props.disabled || rows.length === 0}
          options={rows}
          onChange={(value) => {
            props.onCommit(props.path, value);
          }}
        />
        <ClearButton {...props} />
      </div>
      <FieldFindings field={key} diagnostics={props.diagnostics} />
    </div>
  );
}

/**
 * A colour, as the text of it and as a swatch that opens the browser's own
 * picker. The two show one value: the box takes `#rgb` as readily as
 * `#rrggbb`, and a pick writes the six-digit form the picker produces.
 *
 * Selected placements that disagree get the word in the box and a hatch over
 * the swatch. The picker element shows one colour and nothing else, so without
 * the hatch a disagreement would look like the black it falls back to.
 */
function ColorField(props: FieldProps): React.JSX.Element {
  const key = fieldKey(props.path);
  const { value, mixed } = sharedValue(props.values);
  const held = mixed || typeof value !== "string" ? "" : value;
  return (
    <div>
      <TextField
        label={props.label}
        testId={`field-${key}`}
        value={held}
        placeholder={emptyLabel(mixed, props.description)}
        disabled={props.disabled}
        invalid={props.diagnostics.length > 0}
        reject={(text) => refusedColor(text)}
        onCommit={(text) => {
          props.onCommit(props.path, text.trim());
        }}
      >
        <span
          className={mixed ? "ye-swatch-slot is-mixed" : "ye-swatch-slot"}
          data-testid={`swatch-slot-${key}`}
        >
          <input
            type="color"
            className="ye-swatch"
            data-testid={`swatch-${key}`}
            aria-label={`${props.label} picker`}
            // The element keeps its own value while the picker is open, and
            // the key hands it a new one whenever the held colour changes
            // underneath it. React writing the held value back on every move
            // through the spectrum would fight the picker.
            key={swatchColor(held)}
            defaultValue={swatchColor(held)}
            disabled={props.disabled}
            onChange={(event) => {
              // Commits on `change` only: the picker sends one of those per
              // pick and an input event per move through the spectrum. One
              // edit per pick, rather than one per pixel travelled.
              if (event.nativeEvent.type !== "change") return;
              props.onCommit(props.path, event.currentTarget.value);
            }}
          />
        </span>
        <ClearButton {...props} />
      </TextField>
      <FieldFindings field={key} diagnostics={props.diagnostics} />
    </div>
  );
}

/** Three or six hex digits behind a `#`, the shapes a level file may hold. */
const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;

/** Why the typed text is not a colour, if it is not. */
function refusedColor(text: string): string | undefined {
  return HEX_COLOR.test(text.trim())
    ? undefined
    : 'Type a colour such as "#ff8800".';
}

/**
 * What the swatch shows: the held colour in the six-digit lowercase form the
 * element accepts, and black for text that is not a colour — which the box
 * beside it is already refusing or reporting.
 */
function swatchColor(held: string): string {
  if (!HEX_COLOR.test(held)) return "#000000";
  const digits = held.slice(1).toLowerCase();
  return digits.length === 3
    ? `#${[...digits].map((digit) => digit + digit).join("")}`
    : `#${digits}`;
}

/**
 * What every control shows in place of a value an optional field does not
 * hold. One word across the box, the text area and the dropdown, so nothing
 * chosen reads the same wherever it is met.
 */
const EMPTY_LABEL = "None";

/**
 * The greyed word a box shows when it holds no text of its own: that the
 * selected placements differ, else that an optional value is not there.
 */
function emptyLabel(
  mixed: boolean,
  description: ParamValueDescription,
): string | undefined {
  if (mixed) return MIXED_LABEL;
  return description.optional === true ? EMPTY_LABEL : undefined;
}

/** The members each fixed-arity kind is written with, in order. */
const TUPLE_MEMBERS: Readonly<Record<"vec2" | "point", readonly string[]>> = {
  vec2: ["x", "y"],
  point: ["x", "y"],
};

/**
 * A value with a fixed set of numbers: one box per member.
 *
 * A member commits at its own path, the way an object's member does, so each
 * selected placement keeps whatever it holds for the members that were not
 * typed. When a selected placement holds no object of the declared shape — an
 * optional one emptied, or a value authored against a declaration that has
 * since changed — the box commits the whole value instead: the members it did
 * not change taken from what the selection holds, or from the declared default
 * when it holds nothing or does not agree. Typing one number then writes a
 * whole value rather than half of one.
 *
 * A `point` also has a handle in the viewport, and the boxes follow it while
 * it is being dragged.
 */
function TupleField(props: FieldProps): React.JSX.Element {
  const { description } = props;
  const key = fieldKey(props.path);
  const members = TUPLE_MEMBERS[description.kind as "vec2" | "point"];
  const objects = props.values.map(objectValue);
  const { value, mixed } = sharedValue(props.values);
  const held = objectValue(value);
  // A selection that does not agree has no value to carry the untyped members
  // through, so they come from the declaration's default — the one value every
  // selected placement accepts.
  const fallback = objectValue(description.defaultValue) ?? {};
  const carried = mixed ? fallback : (held ?? fallback);
  return (
    <div>
      <div className="ye-field">
        <span className="ye-field__label">{props.label}</span>
        <div className="ye-tuple" data-testid={`field-${key}`}>
          {members.map((member) => {
            const shared = sharedValue(
              objects.map((object) => object?.[member]),
            );
            return (
              <TextField
                key={member}
                className="ye-num"
                label={member}
                testId={`field-${key}-${member}`}
                value={shared.mixed ? "" : memberText(shared.value)}
                numeric
                placeholder={
                  shared.mixed
                    ? MIXED_LABEL
                    : shared.value === undefined
                      ? EMPTY_LABEL
                      : undefined
                }
                disabled={props.disabled}
                invalid={props.diagnostics.length > 0}
                reject={(text) => refusedNumber(text, description)}
                stepping={{
                  step: (text, intent) =>
                    steppedNumber(text, description, intent),
                }}
                onCommit={(text) => {
                  const typed = Number(text.trim());
                  if (everyHoldsMember(objects, member)) {
                    props.onCommit([...props.path, member], typed);
                    return;
                  }
                  props.onCommit(
                    props.path,
                    committedTuple(members, carried, member, typed),
                  );
                }}
              />
            );
          })}
        </div>
        <ClearButton {...props} />
      </div>
      <FieldFindings field={key} diagnostics={props.diagnostics} />
    </div>
  );
}

/**
 * A value with declared members, drawn as an indented group under its label:
 * one control per member, each the control its own kind names.
 *
 * A member commits at its own path, so two members of one object are two
 * independent edits and an undo takes back the one that was made — and each
 * selected placement keeps whatever it holds for the members that were not
 * touched. When a selected placement holds no object of the declared shape —
 * an optional one emptied, or a value authored against a declaration that has
 * since changed — a member commits the whole object instead: each declared
 * member filled in from the shared value, or from the default where there is
 * none or the selection does not agree, and that member replaced. Typing into
 * one box writes a value the declaration accepts rather than half of one.
 */
function ObjectField(props: FieldProps): React.JSX.Element {
  const { description } = props;
  const key = fieldKey(props.path);
  // One description type covers every kind, so `fields` is optional on it; a
  // node whose `kind` is `object` always carries its members.
  const members = description.fields as readonly ParamFieldDescription[];
  const objects = props.values.map(objectValue);
  const shared = sharedValue(props.values);
  const held = objectValue(shared.value);
  const fallback = objectValue(description.defaultValue) ?? {};
  // A selection that does not agree has no value to carry the untouched
  // members through, so the fallback composition uses the declared default.
  const carried = shared.mixed ? fallback : (held ?? fallback);
  return (
    <div>
      <div className="ye-field">
        <span className="ye-field__label">{props.label}</span>
        <ClearButton {...props} />
      </div>
      <div className="ye-members" data-testid={`field-${key}`}>
        {members.map((member) => (
          <Field
            {...props}
            key={member.name}
            description={member}
            label={member.name}
            path={[...props.path, member.name]}
            values={objects.map((object) => object?.[member.name])}
            diagnostics={[]}
            onCommit={(path, chosen) => {
              if (everyHoldsMember(objects, member.name)) {
                props.onCommit(path, chosen);
                return;
              }
              props.onCommit(props.path, {
                ...carried,
                ...composed(members, carried),
                [member.name]: chosen,
              });
            }}
          />
        ))}
      </div>
      <FieldFindings field={key} diagnostics={props.diagnostics} />
    </div>
  );
}

/**
 * A list of values, one row per element: the element's own control, buttons to
 * move it up or down and to take it out, and an Add at the foot that appends
 * the value the declaration gives an element.
 *
 * A row's control commits at its own position. Adding, removing and reordering
 * commit the whole list, because each of them changes which position every
 * later element is at — an element edit and a list edit are different edits,
 * chosen by what changed.
 *
 * Selected placements holding different lists get no rows at all, only the
 * word and the two edits that mean one thing over any of them: a list's
 * positions are its own, so row three of one list and row three of another are
 * not the same value to write.
 *
 * Buttons rather than a drag: the hierarchy's drag moves placements the
 * document names by id, and a list names its elements by position instead.
 */
function ListField(props: FieldProps): React.JSX.Element {
  const { description } = props;
  const key = fieldKey(props.path);
  // One description type covers every kind, so `item` is optional on it; a
  // node whose `kind` is `array` always carries its element's description.
  const item = description.item as ParamValueDescription;
  const { value, mixed } = sharedValue(props.values);
  const held = Array.isArray(value)
    ? (value as readonly JsonValue[])
    : undefined;
  const rows = mixed ? [] : (held ?? []);
  const ids = useRowIds(rows.length);
  const listRef = useRef<HTMLDivElement | null>(null);
  const refocus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const testId = refocus.current;
    if (testId === undefined) return;
    refocus.current = undefined;
    focusButton(listRef.current, testId);
  });
  const commitList = (list: readonly JsonValue[]): void => {
    props.onCommit(props.path, [...list]);
  };
  const move = (
    from: number,
    to: number,
    button: "up" | "down",
    clicks: number,
  ): void => {
    // A press of the keyboard leaves the focus on the button, which is about
    // to belong to whichever element takes this position. `detail` counts the
    // clicks a pointer made, so 0 is the keyboard.
    if (clicks === 0) refocus.current = `field-${key}-${button}-${String(to)}`;
    ids.swap(from, to);
    commitList(swapped(rows, from, to));
  };
  return (
    <div>
      <div className="ye-field">
        <span className="ye-field__label">{props.label}</span>
        {mixed ? <MixedValue {...props} /> : null}
        <ClearButton {...props} />
      </div>
      <div className="ye-members" data-testid={`field-${key}`} ref={listRef}>
        {rows.map((_element, index) => (
          <div
            key={ids.at(index)}
            className="ye-members__row"
            data-testid={`field-${key}-row-${String(index)}`}
          >
            <Field
              {...props}
              description={item}
              label={String(index)}
              path={[...props.path, String(index)]}
              values={props.values.map((one) =>
                Array.isArray(one)
                  ? (one as readonly JsonValue[])[index]
                  : undefined,
              )}
              diagnostics={[]}
            />
            <div className="ye-members__actions">
              <Button
                testId={`field-${key}-up-${String(index)}`}
                title="Move up"
                disabled={props.disabled || index === 0}
                onClick={(event) => {
                  move(index, index - 1, "up", event.detail);
                }}
              >
                ▲
              </Button>
              <Button
                testId={`field-${key}-down-${String(index)}`}
                title="Move down"
                disabled={props.disabled || index === rows.length - 1}
                onClick={(event) => {
                  move(index, index + 1, "down", event.detail);
                }}
              >
                ▼
              </Button>
              <Button
                testId={`field-${key}-remove-${String(index)}`}
                title="Remove"
                disabled={props.disabled}
                onClick={() => {
                  ids.remove(index);
                  commitList(rows.filter((_, at) => at !== index));
                }}
              >
                ✕
              </Button>
            </div>
          </div>
        ))}
        {mixed ? null : (
          <Button
            testId={`field-${key}-add`}
            disabled={props.disabled}
            onClick={() => {
              commitList([...rows, item.defaultValue]);
            }}
          >
            Add
          </Button>
        )}
      </div>
      <FieldFindings field={key} diagnostics={props.diagnostics} />
    </div>
  );
}

/** What a list's rows are keyed by, and how a change to the list moves them. */
interface RowIds {
  readonly at: (index: number) => number;
  readonly swap: (from: number, to: number) => void;
  readonly remove: (index: number) => void;
}

/**
 * An identity per row, for as long as the control is on screen.
 *
 * A row is a position and an element carries no identity of its own, so a row
 * keyed by its position would hand the box there whatever the element that
 * used to be there left half-typed in it, and would leave a key press that
 * reordered the list focused on a button that now belongs to something else.
 * The ids move with the elements instead: a swap swaps them, a removal takes
 * one out, and a row the list grew takes an id nothing has had.
 */
function useRowIds(count: number): RowIds {
  const ids = useRef<number[]>([]);
  const minted = useRef(0);
  while (ids.current.length < count) {
    ids.current.push(minted.current);
    minted.current += 1;
  }
  ids.current.length = count;
  return {
    at: (index) => ids.current[index] as number,
    swap: (from, to) => {
      const moved = ids.current[from] as number;
      ids.current[from] = ids.current[to] as number;
      ids.current[to] = moved;
    },
    remove: (index) => {
      ids.current.splice(index, 1);
    },
  };
}

/**
 * Put the keyboard on one of a row's buttons, or on the one beside it when the
 * move it just made disabled it — a press that carried an element to an end of
 * the list has to leave the focus somewhere it can act.
 */
function focusButton(list: HTMLElement | null, testId: string): void {
  const button = list?.querySelector<HTMLButtonElement>(
    `[data-testid="${testId}"]`,
  );
  if (button === null || button === undefined) return;
  if (!button.disabled) {
    button.focus();
    return;
  }
  const beside = button.parentElement?.querySelector<HTMLButtonElement>(
    "button:not([disabled])",
  );
  beside?.focus();
}

/**
 * A value of no declared shape, as the JSON text of it.
 *
 * The box holds formatted text and commits what it parses to, so the document
 * gets a value and not a string. Text that is not JSON stays in the box with
 * the parser's own reason beside it, since there is nothing here to write, and
 * text that parses to what the field already holds writes nothing either — so
 * reindenting the box is not an edit to undo.
 *
 * Selected placements holding different values get the word and the two edits
 * that mean one thing over any of them, for the reason a list does: there is
 * no text to show them all, and typing over one would be typing over the
 * others unseen.
 */
function JsonField(props: FieldProps): React.JSX.Element {
  const key = fieldKey(props.path);
  const { value, mixed } = sharedValue(props.values);
  if (mixed) {
    return (
      <div className="ye-field">
        <span className="ye-field__label">{props.label}</span>
        <MixedValue {...props} />
        <ClearButton {...props} />
      </div>
    );
  }
  const held = value as JsonValue | undefined;
  const empty = value === null || value === undefined;
  return (
    <div>
      <TextField
        label={props.label}
        testId={`field-${key}`}
        value={empty ? "" : JSON.stringify(value, null, 2)}
        multiline
        placeholder={empty ? EMPTY_LABEL : undefined}
        disabled={props.disabled}
        invalid={props.diagnostics.length > 0}
        reject={(text) => refusedJson(text)}
        onCommit={(text) => {
          const parsed = JSON.parse(text) as JsonValue;
          if (held !== undefined && equalJson(parsed, held)) return;
          props.onCommit(props.path, parsed);
        }}
      >
        <ClearButton {...props} />
      </TextField>
      <FieldFindings field={key} diagnostics={props.diagnostics} />
    </div>
  );
}

/** Why the typed text is not JSON, if it is not. */
function refusedJson(text: string): string | undefined {
  if (text.trim() === "") return "Type a JSON value.";
  try {
    JSON.parse(text);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The list with two positions exchanged. */
function swapped(
  list: readonly JsonValue[],
  from: number,
  to: number,
): readonly JsonValue[] {
  const moved = [...list];
  const held = moved[from] as JsonValue;
  moved[from] = moved[to] as JsonValue;
  moved[to] = held;
  return moved;
}

/**
 * A whole object of declared members: what the value holds for each, and the
 * declared default for a member it has nothing for.
 */
function composed(
  members: readonly ParamFieldDescription[],
  from: Readonly<Record<string, unknown>>,
): Record<string, JsonValue> {
  const value: Record<string, JsonValue> = {};
  for (const member of members) {
    value[member.name] = Object.hasOwn(from, member.name)
      ? (from[member.name] as JsonValue)
      : member.defaultValue;
  }
  return value;
}

/**
 * Whether every selected placement holds this member. When one does not — an
 * optional value emptied, or a value authored against a declaration that has
 * since changed — a member edit has to commit the whole value around it.
 */
function everyHoldsMember(
  objects: readonly (Readonly<Record<string, JsonValue>> | undefined)[],
  member: string,
): boolean {
  return objects.every(
    (object) => object !== undefined && Object.hasOwn(object, member),
  );
}

/** The members of an authored object, or nothing when it is not one. */
function objectValue(
  value: unknown,
): Readonly<Record<string, JsonValue>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : undefined;
}

/** What one box of a tuple shows: its number, or nothing at all. */
function memberText(value: unknown): string {
  if (typeof value === "number") return String(rounded(value));
  return typeof value === "string" ? value : "";
}

/**
 * The whole value one box commits: every member as it stands, with the one
 * typed replaced. A member the held value has no number for takes 0, so the
 * result is a value the field's own kind accepts.
 */
function committedTuple(
  members: readonly string[],
  from: Readonly<Record<string, unknown>>,
  member: string,
  typed: number,
): JsonValue {
  const value: Record<string, JsonValue> = {};
  for (const name of members) {
    const held = from[name];
    value[name] = name === member ? typed : typeof held === "number" ? held : 0;
  }
  return value;
}

/**
 * What a field shows: the value a drag of its handle has reached while one is
 * running, and what the document holds otherwise.
 */
function liveValue(
  state: EditorState,
  placement: LevelPlacement,
  path: readonly string[],
): unknown {
  const drag = state.paramDrag;
  if (
    drag &&
    drag.id === placement.id &&
    path.length === 1 &&
    drag.field === path[0]
  ) {
    return draggedValue(state, drag);
  }
  return valueAt(placement.params, path);
}

/**
 * Empties an optional value. A required one has no such value, so it gets no
 * button at all. It stays live while any selected placement still holds
 * something, which is what empties the rest of a selection that differs.
 */
function ClearButton(props: FieldProps): React.JSX.Element | null {
  if (props.description.optional !== true) return null;
  return (
    <Button
      testId={`clear-${fieldKey(props.path)}`}
      disabled={props.disabled || props.values.every((one) => one === null)}
      onClick={() => {
        props.onCommit(props.path, null);
      }}
    >
      Clear
    </Button>
  );
}

/**
 * What a value with no one text stands as: the word, and the edit that puts
 * every selected placement back on its declaration's default.
 */
function MixedValue(props: FieldProps): React.JSX.Element {
  const key = fieldKey(props.path);
  return (
    <>
      <span className="ye-field__mixed" data-testid={`field-${key}-mixed`}>
        {MIXED_LABEL}
      </span>
      <Button
        testId={`reset-${key}`}
        disabled={props.disabled}
        onClick={() => {
          props.onReset(props.path);
        }}
      >
        Reset
      </Button>
    </>
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
 * Which kind's control a value is drawn with: its own, or for a value the game
 * decodes, the one its declaration named. A control reads this rather than
 * `kind` wherever the two kinds behave differently.
 */
function controlKind(description: ParamValueDescription): ParamKindName {
  if (description.kind !== "custom") return description.kind;
  return description.editor ?? "json";
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
  description: ParamValueDescription,
): string | undefined {
  const typed = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(typed)) return "Type a number.";
  if (controlKind(description) === "integer" && !Number.isInteger(typed)) {
    return "Type a whole number.";
  }
  if (description.min !== undefined && typed < description.min) {
    return `Type ${String(description.min)} or more.`;
  }
  if (description.max !== undefined && typed > description.max) {
    return `Type ${String(description.max)} or less.`;
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
  description: ParamValueDescription,
  intent: StepIntent,
): string | undefined {
  const from = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(from)) return undefined;
  const whole = controlKind(description) === "integer";
  const unit = whole ? 1 : (description.step ?? 1);
  const by = intent.coarse
    ? unit * 10
    : intent.fine && !whole
      ? unit / 10
      : unit;
  let next = rounded(from + by * intent.direction);
  const { min, max } = description;
  if (min !== undefined) next = Math.max(next, min);
  if (max !== undefined) next = Math.min(next, max);
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
