import { useState } from "react";
import type { SequenceContract } from "@yagejs-addons/sequence/document";
import type { CommandController } from "../commands/index.js";
import type { PlaceableType } from "../project/index.js";
import type { EditorStore } from "../store/index.js";
import { useEditorState } from "./useEditorSlice.js";
import { SequenceContractEditor } from "./SequenceContractEditor.js";
import { JsonField } from "./SequencePanel.js";
export function SequenceActorInspector({
  store,
  commands,
  placeables,
}: {
  store: EditorStore;
  commands: CommandController;
  placeables: () => readonly PlaceableType[];
}): React.JSX.Element | null {
  const state = useEditorState(store),
    doc = state.document;
  const [error, setError] = useState("");
  if (doc.format !== "yage-sequence-workspace") return null;
  const id = [...state.selection][0],
    placement = doc.entities.find((p) => p.id === id);
  const slot = Object.entries(doc.bindings).find(([, p]) => p === id)?.[0];
  const edit = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section className="ye-sequence-actor" aria-label="Sequence actor">
      <button
        onClick={() => commands.createPlacement("yage.sequence-placeholder")}
      >
        Add placeholder actor
      </button>
      <p>
        Add a project entity from Actors below the preview. Its declared
        parameters control its appearance.
      </p>
      {Object.keys(doc.sequence.targets)
        .filter(
          (name) => !doc.entities.some((p) => p.id === doc.bindings[name]),
        )
        .map((name) => (
          <div key={name} role="alert">
            <p>Actor {name} has no preview placement.</p>
            <label>
              Existing preview
              <select
                aria-label={`Preview for ${name}`}
                value=""
                onChange={(e) =>
                  edit(() => commands.bindSequenceActor(name, e.target.value))
                }
              >
                <option value="">Choose an entity…</option>
                {doc.entities
                  .filter((p) => !Object.values(doc.bindings).includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name ?? p.id} · {p.type}
                    </option>
                  ))}
              </select>
            </label>
            <button
              onClick={() =>
                commands.createPlacement("yage.sequence-placeholder", name)
              }
            >
              Restore preview for {name}
            </button>
          </div>
        ))}
      {placement && slot ? (
        <>
          <label>
            Runtime slot
            <input
              aria-label="Runtime slot"
              key={slot}
              defaultValue={slot}
              onBlur={(e) =>
                edit(() => commands.renameSequenceActor(slot, e.target.value))
              }
            />
          </label>
          <label>
            Preview entity
            <select
              aria-label="Preview entity"
              value={placement.type}
              onChange={(e) =>
                commands.changePreviewType(placement.id, e.target.value)
              }
            >
              {placeables().map((p) => (
                <option key={p.typeId} value={p.typeId}>
                  {p.typeId}
                </option>
              ))}
            </select>
          </label>
          <p>
            At play time, the game supplies <code>targets["{slot}"]</code>.
            Changing this preview keeps its keys.
          </p>
          <details>
            <summary>Actor contract</summary>
            <SequenceContractEditor
              key={slot}
              document={doc.sequence}
              slot={slot}
              onChange={(document) =>
                edit(() => commands.editSequence({ kind: "replace", document }))
              }
            />
            <details>
              <summary>Contract JSON</summary>
              <JsonField
                label="Actor contract"
                value={doc.sequence.targets[slot]}
                onCommit={(value) =>
                  edit(() =>
                    commands.editSequence({
                      kind: "replace",
                      document: {
                        ...doc.sequence,
                        targets: {
                          ...doc.sequence.targets,
                          [slot]: value as SequenceContract,
                        },
                      },
                    }),
                  )
                }
              />
            </details>
          </details>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
