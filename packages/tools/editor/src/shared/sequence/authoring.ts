import { parseSequence } from "@yagejs-addons/sequence/document";
import type {
  SequenceDocument,
  SequenceProperty,
  SequenceMarker,
} from "@yagejs-addons/sequence/document";
import { defaultSequenceValue } from "./defaults.js";

/** Remove a selection atomically; a track's initial key is always retained. */
export function removeSequenceKeys(
  document: SequenceDocument,
  ids: readonly string[],
): SequenceDocument {
  if (
    document.tracks.some((t) =>
      t.keys.some((k) => ids.includes(k.id) && k.frame === 0),
    )
  )
    throw new Error(
      "Frame-zero keys cannot be deleted; remove the track instead",
    );
  return parseSequence({
    ...document,
    tracks: document.tracks.map((t) => ({
      ...t,
      keys: t.keys.filter((k) => !ids.includes(k.id)),
    })),
  });
}
export function markerPayload(
  document: SequenceDocument,
  target: string,
  event: string,
): SequenceMarker["payload"] {
  const definition = document.targets[target]?.events[event];
  if (!definition) throw new Error(`Unknown event ${target}.${event}`);
  return Object.fromEntries(
    Object.entries(definition).map(([name, field]) => [
      name,
      defaultSequenceValue(field),
    ]),
  );
}
/** Contract edits update dependent keys and payloads in the same document command. */
export function addContractProperty(
  doc: SequenceDocument,
  slot: string,
  name: string,
  definition: SequenceProperty,
): SequenceDocument {
  const contract = doc.targets[slot];
  if (!contract || !name.trim() || Object.hasOwn(contract.properties, name))
    throw new Error("Choose a unique, nonempty property name");
  return parseSequence({
    ...doc,
    targets: {
      ...doc.targets,
      [slot]: {
        ...contract,
        properties: { ...contract.properties, [name]: definition },
      },
    },
  });
}
export function removeContractProperty(
  doc: SequenceDocument,
  slot: string,
  name: string,
): SequenceDocument {
  const contract = doc.targets[slot];
  if (!contract) throw new Error(`Unknown actor ${slot}`);
  return parseSequence({
    ...doc,
    targets: {
      ...doc.targets,
      [slot]: {
        ...contract,
        properties: Object.fromEntries(
          Object.entries(contract.properties).filter(([key]) => key !== name),
        ),
      },
    },
    tracks: doc.tracks.filter((t) => t.target !== slot || t.property !== name),
  });
}
export function addContractEvent(
  doc: SequenceDocument,
  slot: string,
  name: string,
): SequenceDocument {
  const contract = doc.targets[slot];
  if (!contract || !name.trim() || Object.hasOwn(contract.events, name))
    throw new Error("Choose a unique, nonempty event name");
  return parseSequence({
    ...doc,
    targets: {
      ...doc.targets,
      [slot]: { ...contract, events: { ...contract.events, [name]: {} } },
    },
  });
}
export function removeContractEvent(
  doc: SequenceDocument,
  slot: string,
  name: string,
): SequenceDocument {
  const contract = doc.targets[slot];
  if (!contract) throw new Error(`Unknown actor ${slot}`);
  return parseSequence({
    ...doc,
    targets: {
      ...doc.targets,
      [slot]: {
        ...contract,
        events: Object.fromEntries(
          Object.entries(contract.events).filter(([key]) => key !== name),
        ),
      },
    },
    events: doc.events.filter((e) => e.target !== slot || e.event !== name),
  });
}
export function editPayloadField(
  doc: SequenceDocument,
  slot: string,
  event: string,
  name: string,
  definition: SequenceProperty | undefined,
): SequenceDocument {
  const contract = doc.targets[slot],
    payload = contract?.events[event];
  if (!contract || !payload || !name.trim())
    throw new Error("Choose an event and a nonempty field name");
  if (definition && Object.hasOwn(payload, name))
    throw new Error(`Payload field ${name} already exists`);
  const fields = Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== name),
  );
  if (definition) fields[name] = definition;
  return parseSequence({
    ...doc,
    targets: {
      ...doc.targets,
      [slot]: { ...contract, events: { ...contract.events, [event]: fields } },
    },
    events: doc.events.map((e) =>
      e.target !== slot || e.event !== event
        ? e
        : {
            ...e,
            payload: definition
              ? { ...e.payload, [name]: defaultSequenceValue(definition) }
              : Object.fromEntries(
                  Object.entries(e.payload).filter(([key]) => key !== name),
                ),
          },
    ),
  });
}
