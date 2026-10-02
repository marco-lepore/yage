import { parseSequence } from "@yagejs-addons/sequence/document";
import type {
  SequenceContract,
  SequenceDocument,
  SequenceKey,
  SequenceMarker,
  SequenceTrack,
} from "@yagejs-addons/sequence/document";
export type SequenceCommand =
  | {
      readonly kind: "add-actor";
      readonly id: string;
      readonly contract: SequenceContract;
      readonly tracks: readonly SequenceTrack[];
    }
  | { readonly kind: "remove-actor"; readonly id: string }
  | {
      readonly kind: "set-settings";
      readonly settings: Partial<
        Pick<SequenceDocument, "name" | "fps" | "duration" | "frame">
      >;
    }
  | {
      readonly kind: "set-key";
      readonly track: string;
      readonly key: SequenceKey;
    }
  | { readonly kind: "remove-key"; readonly track: string; readonly id: string }
  | {
      readonly kind: "move-keys" | "move-events";
      readonly ids: readonly string[];
      readonly delta: number;
    }
  | { readonly kind: "set-track"; readonly track: SequenceTrack }
  | { readonly kind: "remove-track"; readonly id: string }
  | { readonly kind: "set-event"; readonly event: SequenceMarker }
  | { readonly kind: "remove-event"; readonly id: string }
  | { readonly kind: "replace"; readonly document: unknown };
function upsert<T extends { readonly id: string }>(
  items: readonly T[],
  value: T,
): T[] {
  return items.some((item) => item.id === value.id)
    ? items.map((item) => (item.id === value.id ? value : item))
    : [...items, value];
}
/** The only document mutation path. Validates the whole result before publishing. */
export function reduceSequenceCommand(
  document: SequenceDocument,
  command: SequenceCommand,
): SequenceDocument {
  if (command.kind === "replace") return parseSequence(command.document);
  let next: SequenceDocument = document;
  switch (command.kind) {
    case "add-actor":
      if (Object.hasOwn(document.targets, command.id))
        throw new Error(`Actor already exists: ${command.id}`);
      if (command.tracks.some((t) => t.target !== command.id))
        throw new Error("New actor tracks must target that actor");
      next = {
        ...document,
        targets: { ...document.targets, [command.id]: command.contract },
        tracks: [...document.tracks, ...command.tracks],
      };
      break;
    case "remove-actor":
      if (!Object.hasOwn(document.targets, command.id))
        throw new Error(`Unknown actor ${command.id}`);
      next = {
        ...document,
        targets: Object.fromEntries(
          Object.entries(document.targets).filter(([id]) => id !== command.id),
        ),
        tracks: document.tracks.filter((t) => t.target !== command.id),
        events: document.events.filter((e) => e.target !== command.id),
      };
      break;
    case "set-settings":
      next = { ...document, ...command.settings };
      break;
    case "set-key":
    case "remove-key": {
      if (!document.tracks.some((t) => t.id === command.track))
        throw new Error(`Unknown track ${command.track}`);
      next = {
        ...document,
        tracks: document.tracks.map((track) =>
          track.id !== command.track
            ? track
            : {
                ...track,
                keys:
                  command.kind === "set-key"
                    ? upsert(track.keys, command.key).sort(
                        (a, b) => a.frame - b.frame,
                      )
                    : track.keys.filter((k) => k.id !== command.id),
              },
        ),
      };
      break;
    }
    case "move-events": {
      if (!Number.isInteger(command.delta))
        throw new Error("Event movement must be a whole frame");
      if (command.ids.some((id) => !document.events.some((e) => e.id === id)))
        throw new Error("Unknown event in movement");
      next = {
        ...document,
        events: document.events.map((e) =>
          command.ids.includes(e.id)
            ? { ...e, frame: e.frame + command.delta }
            : e,
        ),
      };
      break;
    }
    case "move-keys": {
      if (!Number.isFinite(command.delta))
        throw new Error("Key movement must be finite");
      const keys = new Set(
        document.tracks.flatMap((t) => t.keys.map((k) => k.id)),
      );
      if (command.ids.some((id) => !keys.has(id)))
        throw new Error("Unknown key in movement");
      next = {
        ...document,
        tracks: document.tracks.map((t) => ({
          ...t,
          keys: t.keys
            .map((k) =>
              command.ids.includes(k.id)
                ? { ...k, frame: k.frame + command.delta }
                : k,
            )
            .sort((a, b) => a.frame - b.frame),
        })),
      };
      break;
    }
    case "set-track":
      next = { ...document, tracks: upsert(document.tracks, command.track) };
      break;
    case "remove-track":
      next = {
        ...document,
        tracks: document.tracks.filter((t) => t.id !== command.id),
      };
      break;
    case "set-event":
      next = { ...document, events: upsert(document.events, command.event) };
      break;
    case "remove-event":
      next = {
        ...document,
        events: document.events.filter((e) => e.id !== command.id),
      };
      break;
  }
  return parseSequence(next);
}
