import type { ParamFieldDescription } from "@yagejs/level";
import type { LevelPlacement } from "@yagejs/level/document";
import { useEffect, useRef, useState } from "react";
import {
  derivedSceneKey,
  sceneKeyHolder,
} from "../../shared/commands/index.js";
import type { EditorDiagnostic } from "../../shared/diagnostics/index.js";
import type { AssetListing } from "../../shared/protocol/index.js";
import type { InspectableType } from "../project/index.js";
import type { EditorState, EditorStore } from "../store/index.js";
import { Panel, PanelEmpty } from "./Panel.js";
import { Button, TextField, trimmedOrNull } from "./controls.js";
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
  readonly onSetParam: (id: string, field: string, value: string) => void;
  readonly onResetParam: (id: string, field: string) => void;
  readonly onResetPlacement: (id: string) => void;
  readonly onSetKey: (id: string, key: string | null) => void;
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

      <KeySection {...props} />
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
  onCommit: (value: string) => void;
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
      {invalid ? (
        <ul
          data-testid={`field-${field.name}-diagnostics`}
          className="ye-messages ye-messages--error"
        >
          {props.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${String(index)}`}>
              {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
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
