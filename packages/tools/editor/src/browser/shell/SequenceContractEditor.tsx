import { useState } from "react";
import type {
  SequenceDocument,
  SequenceProperty,
} from "@yagejs-addons/sequence/document";
import {
  addContractProperty,
  removeContractProperty,
  addContractEvent,
  removeContractEvent,
  editPayloadField,
} from "../../shared/sequence/authoring.js";
import { Button } from "./controls.js";

function PropertyForm({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (name: string, definition: SequenceProperty) => void;
}): React.JSX.Element {
  const [name, setName] = useState(""),
    [kind, setKind] = useState<SequenceProperty["kind"]>("number"),
    [values, setValues] = useState("idle, walk");
  return (
    <div className="ye-sequence__fields">
      <label>
        {label} name
        <input
          aria-label={`${label} name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        {label} kind
        <select
          aria-label={`${label} kind`}
          value={kind}
          onChange={(e) => setKind(e.target.value as SequenceProperty["kind"])}
        >
          {["number", "vector", "position", "color", "boolean", "enum"].map(
            (v) => (
              <option key={v}>{v}</option>
            ),
          )}
        </select>
      </label>
      {kind === "enum" ? (
        <label>
          Enum choices
          <input
            aria-label={`${label} enum choices`}
            value={values}
            onChange={(e) => setValues(e.target.value)}
          />
        </label>
      ) : null}
      <Button
        disabled={!name.trim()}
        onClick={() => {
          onAdd(
            name.trim(),
            kind === "enum"
              ? {
                  kind,
                  values: values
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                }
              : { kind },
          );
        }}
      >
        Add {label.toLowerCase()}
      </Button>
    </div>
  );
}
/** Edit contract data and its dependent keys or markers in one accepted command. */
export function SequenceContractEditor({
  document,
  slot,
  onChange,
}: {
  document: SequenceDocument;
  slot: string;
  onChange: (doc: SequenceDocument) => void;
}): React.JSX.Element {
  const contract = document.targets[slot]!;
  const [event, setEvent] = useState("");
  const [error, setError] = useState("");
  const change = (operation: () => SequenceDocument) => {
    try {
      onChange(operation());
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div>
      {error ? <p role="alert">{error}</p> : null}
      <h4>Properties</h4>
      {Object.entries(contract.properties).map(([name, definition]) => (
        <div key={name} className="ye-sequence__contract-row">
          <span>
            {name} · {definition.kind}
          </span>
          <Button
            ariaLabel={`Remove property ${name}`}
            title="Remove this property and its track"
            onClick={() =>
              change(() => removeContractProperty(document, slot, name))
            }
          >
            Remove
          </Button>
        </div>
      ))}
      <PropertyForm
        label="Property"
        onAdd={(name, definition) =>
          change(() => addContractProperty(document, slot, name, definition))
        }
      />
      <h4>Events</h4>
      {Object.entries(contract.events).map(([name, payload]) => (
        <details key={name}>
          <summary>{name}</summary>
          <Button
            ariaLabel={`Remove event definition ${name}`}
            title="Remove this event and its markers"
            onClick={() =>
              change(() => removeContractEvent(document, slot, name))
            }
          >
            Remove event definition
          </Button>
          {Object.entries(payload).map(([field, definition]) => (
            <div key={field}>
              {field} · {definition.kind}
              <Button
                ariaLabel={`Remove ${name} field ${field}`}
                onClick={() =>
                  change(() =>
                    editPayloadField(document, slot, name, field, undefined),
                  )
                }
              >
                Remove field
              </Button>
            </div>
          ))}
          <PropertyForm
            label={`${name} payload field`}
            onAdd={(field, definition) =>
              change(() =>
                editPayloadField(document, slot, name, field, definition),
              )
            }
          />
        </details>
      ))}
      <label>
        Event name
        <input
          aria-label="Event name"
          value={event}
          onChange={(e) => setEvent(e.target.value)}
        />
      </label>
      <Button
        disabled={!event.trim()}
        onClick={() =>
          change(() => addContractEvent(document, slot, event.trim()))
        }
      >
        Add event definition
      </Button>
    </div>
  );
}
