import { SequenceClip } from "@yagejs-addons/sequence";
import type {
  SequenceContract,
  SequenceDocument,
  SequenceTrack,
  SequenceValue,
  PositionMapping,
} from "@yagejs-addons/sequence/document";
import type { DocumentCommand } from "../../shared/commands/index.js";
import type { SequenceWorkspaceDocument } from "../../shared/document/index.js";
import {
  parentWorld,
  toLocal,
  toWorld,
  placementWorld,
} from "../../shared/document/pose.js";
import { reduceSequenceCommand } from "../../shared/sequence/commands.js";
import { initialSequenceTrack } from "../../shared/sequence/defaults.js";
import { withDescendants } from "./graph.js";
import { sampledDocument } from "../store/sequence.js";
import type { EditorState } from "../store/types.js";

export const TRANSFORM_CONTRACT: SequenceContract = {
  properties: {
    position: { kind: "position" },
    rotation: { kind: "number" },
    scale: { kind: "vector" },
    opacity: { kind: "number" },
    visible: { kind: "boolean" },
  },
  events: { cue: {} },
};
export function sequenceChange(
  doc: SequenceWorkspaceDocument,
  sequence: SequenceDocument,
  bindings = doc.bindings,
  commandId: string = crypto.randomUUID(),
): DocumentCommand {
  return {
    kind: "set-sequence",
    commandId,
    before: { sequence: doc.sequence, bindings: doc.bindings },
    after: { sequence, bindings },
  };
}
/** Seed a new standard track from the current preview pose. */
export function newSequenceTrack(
  state: EditorState,
  target: string,
  property: string,
): SequenceTrack {
  const doc = state.document,
    view = state.sequence;
  if (doc.format !== "yage-sequence-workspace" || !view)
    throw new Error("No sequence workspace");
  const definition = doc.sequence.targets[target]?.properties[property];
  if (!definition)
    throw new Error(`Unknown sequence property ${target}.${property}`);
  const sampled = sampledDocument(state);
  const placement = sampled.entities.find((p) => p.id === doc.bindings[target]);
  let track = initialSequenceTrack(
    crypto.randomUUID(),
    crypto.randomUUID(),
    target,
    property,
    definition,
  );
  let value: SequenceValue | undefined;
  if (property === "scale" && definition.kind === "vector")
    value = placement?.transform.scale ?? { x: 1, y: 1 };
  if (property === "rotation" && definition.kind === "number")
    value = placement?.transform.rotation ?? 0;
  if (property === "opacity" && definition.kind === "number") value = 1;
  if (property === "tint" && definition.kind === "color") value = 0xffffff;
  if (property === "position" && definition.kind === "position" && placement) {
    const clip = new SequenceClip({
      ...doc.sequence,
      tracks: [...doc.sequence.tracks, track],
    });
    value = clip.unmapPosition(
      track.id,
      placementWorld(sampled, placement).position,
      {
        frame: { x: 0, y: 0, width: view.width, height: view.height },
        fit: view.fit,
      },
    );
  }
  if (value !== undefined)
    track = { ...track, keys: track.keys.map((k) => ({ ...k, value })) };
  return track;
}
/** Translate manipulation intent at the cursor into the shared document pipeline. */
export function sequenceIntent(
  state: EditorState,
  command: DocumentCommand,
): DocumentCommand {
  const doc = state.document,
    view = state.sequence;
  if (doc.format !== "yage-sequence-workspace" || !view) return command;
  if (command.kind === "set-poses") {
    let sequence = doc.sequence;
    const sampled = sampledDocument(state);
    const moved = {
      ...sampled,
      entities: sampled.entities.map((p) => ({
        ...p,
        transform:
          command.poses.find((e) => e.id === p.id)?.transform ?? p.transform,
      })),
    };
    for (const pose of command.poses) {
      const slot = Object.entries(doc.bindings).find(
        ([, id]) => id === pose.id,
      )?.[0];
      const before = sampled.entities.find((p) => p.id === pose.id);
      const base = doc.entities.find((p) => p.id === pose.id);
      const after = moved.entities.find((p) => p.id === pose.id);
      if (!slot || !before || !base || !after) continue;
      for (const property of ["position", "rotation", "scale"] as const) {
        if (
          JSON.stringify(before.transform[property]) ===
          JSON.stringify(pose.transform[property])
        )
          continue;
        const expectedKind =
          property === "position"
            ? "position"
            : property === "scale"
              ? "vector"
              : "number";
        if (sequence.targets[slot]?.properties[property]?.kind !== expectedKind)
          continue;
        const existing = sequence.tracks.find(
          (t) => t.target === slot && t.property === property,
        );
        const initial =
          property === "position"
            ? placementWorld(doc, base).position
            : base.transform[property];
        let track: SequenceTrack = existing ?? {
          id: crypto.randomUUID(),
          target: slot,
          property,
          ...(property === "position"
            ? { position: { mode: "proportional" as const } }
            : {}),
          keys: [
            {
              id: crypto.randomUUID(),
              frame: 0,
              value: initial,
              curve: "linear",
            },
          ],
        };
        let value: SequenceValue =
          property === "position"
            ? placementWorld(moved, after).position
            : pose.transform[property];
        if (property === "position") {
          const clip = new SequenceClip(
            existing
              ? sequence
              : { ...sequence, tracks: [...sequence.tracks, track] },
          );
          if (!existing)
            track = {
              ...track,
              keys: track.keys.map((k) => ({
                ...k,
                value: clip.unmapPosition(
                  track.id,
                  k.value as { x: number; y: number },
                  {
                    frame: {
                      x: 0,
                      y: 0,
                      width: view.width,
                      height: view.height,
                    },
                    fit: view.fit,
                  },
                ),
              })),
            };
          value = clip.unmapPosition(
            track.id,
            value as { x: number; y: number },
            {
              frame: { x: 0, y: 0, width: view.width, height: view.height },
              fit: view.fit,
            },
          );
        }
        const frame = Math.round(Math.min(view.frame, sequence.duration));
        const old = track.keys.find((k) => k.frame === frame);
        sequence = reduceSequenceCommand(sequence, {
          kind: "set-track",
          track: {
            ...track,
            keys: [
              ...track.keys.filter((k) => k.frame !== frame),
              {
                id: old?.id ?? crypto.randomUUID(),
                frame,
                value,
                curve: old?.curve ?? "linear",
              },
            ].sort((a, b) => a.frame - b.frame),
          },
        });
      }
    }
    const boundIds = new Set(Object.values(doc.bindings));
    const contextPoses = command.poses.filter((pose) => !boundIds.has(pose.id));
    if (contextPoses.length === command.poses.length) return command;
    const keys = sequenceChange(doc, sequence, doc.bindings, command.commandId);
    if (contextPoses.length === 0) return keys;
    return {
      kind: "transaction",
      commandId: command.commandId,
      commands: [{ ...command, poses: contextPoses }, keys],
    };
  }
  if (command.kind === "add-placements") {
    let sequence = doc.sequence;
    const bindings = { ...doc.bindings };
    const placed = {
      ...doc,
      entities: [...doc.entities, ...command.inserts.map((i) => i.placement)],
    };
    for (const { placement } of command.inserts) {
      let slot =
        placement.key ??
        placement.name ??
        placement.type.split(".").at(-1) ??
        "actor";
      const prefix = slot;
      let count = 2;
      while (Object.hasOwn(sequence.targets, slot))
        slot = `${prefix}${count++}`;
      bindings[slot] = placement.id;
      const values = {
        position: placementWorld(placed, placement).position,
        rotation: placement.transform.rotation,
        scale: placement.transform.scale,
        opacity: 1,
        visible: true,
      };
      let tracks = Object.entries(values).map(([property, value]) =>
        initialSequenceTrack(
          crypto.randomUUID(),
          crypto.randomUUID(),
          slot,
          property,
          TRANSFORM_CONTRACT.properties[property]!,
          value,
        ),
      );
      const sampler = new SequenceClip({
        ...sequence,
        targets: { ...sequence.targets, [slot]: TRANSFORM_CONTRACT },
        tracks: [...sequence.tracks, ...tracks],
      });
      tracks = tracks.map((t) =>
        t.position
          ? {
              ...t,
              keys: t.keys.map((k) => ({
                ...k,
                value: sampler.unmapPosition(
                  t.id,
                  k.value as { x: number; y: number },
                  {
                    frame: {
                      x: 0,
                      y: 0,
                      width: view.width,
                      height: view.height,
                    },
                    fit: view.fit,
                  },
                ),
              })),
            }
          : t,
      );
      sequence = reduceSequenceCommand(sequence, {
        kind: "add-actor",
        id: slot,
        contract: TRANSFORM_CONTRACT,
        tracks,
      });
    }
    return {
      kind: "transaction",
      commandId: command.commandId,
      commands: [command, sequenceChange(doc, sequence, bindings)],
    };
  }
  if (command.kind === "move-placements") {
    const authoredMoves = command.moves.map((move) => {
      const original = doc.entities.find((p) => p.id === move.id)!;
      const transform =
        move.from.parent === move.to.parent
          ? original.transform
          : toLocal(
              toWorld(original.transform, parentWorld(doc, original.parent)),
              parentWorld(doc, move.to.parent),
              original.transform,
            );
      return {
        ...move,
        from: { ...move.from, transform: original.transform },
        to: { ...move.to, transform },
      };
    });
    const moved = {
      ...doc,
      entities: doc.entities.map((p) => {
        const move = authoredMoves.find((m) => m.id === p.id);
        if (!move) return p;
        const next = { ...p, transform: move.to.transform };
        Reflect.deleteProperty(next, "parent");
        return {
          ...next,
          ...(move.to.parent ? { parent: move.to.parent } : {}),
        };
      }),
    };
    const keys = sequenceIntent(
      { ...state, document: moved },
      {
        kind: "set-poses",
        commandId: crypto.randomUUID(),
        poses: command.moves
          .filter((m) => m.from.parent !== m.to.parent)
          .map((m) => ({ id: m.id, transform: m.to.transform })),
      },
    );
    return {
      kind: "transaction",
      commandId: command.commandId,
      commands: [
        { ...command, moves: authoredMoves },
        ...(keys.kind === "transaction" ? keys.commands : [keys]),
      ],
    };
  }
  if (command.kind === "remove-placements") {
    const removed = new Set(withDescendants(doc.entities, command.ids));
    let sequence = doc.sequence;
    const bindings = { ...doc.bindings };
    for (const [slot, id] of Object.entries(bindings))
      if (removed.has(id)) {
        sequence = reduceSequenceCommand(sequence, {
          kind: "remove-actor",
          id: slot,
        });
        Reflect.deleteProperty(bindings, slot);
      }
    return {
      kind: "transaction",
      commandId: command.commandId,
      commands: [command, sequenceChange(doc, sequence, bindings)],
    };
  }
  return command;
}

/** Carry an actor's contract, keys and markers when its preview is duplicated. */
export function cloneSequenceActors(
  state: EditorState,
  command: Extract<DocumentCommand, { kind: "add-placements" }>,
  sourceIds: readonly string[],
): DocumentCommand {
  const doc = state.document;
  const view = state.sequence;
  if (doc.format !== "yage-sequence-workspace" || !view) return command;
  const added = sequenceIntent(state, command);
  if (added.kind !== "transaction") return added;
  const edit = added.commands.find((c) => c.kind === "set-sequence");
  if (!edit || edit.kind !== "set-sequence") return added;
  let sequence = edit.after.sequence;
  const sampled = sampledDocument(state);
  const placed = {
    ...sampled,
    entities: [...sampled.entities, ...command.inserts.map((i) => i.placement)],
  };
  const clip = new SequenceClip(doc.sequence);
  for (const [index, insert] of command.inserts.entries()) {
    const sourceId = sourceIds[index];
    const source = doc.entities.find((p) => p.id === sourceId);
    const from = Object.entries(doc.bindings).find(
      ([, id]) => id === sourceId,
    )?.[0];
    const to = Object.entries(edit.after.bindings).find(
      ([, id]) => id === insert.placement.id,
    )?.[0];
    if (!source || !from || !to) continue;
    const contract = doc.sequence.targets[from];
    if (!contract) continue;
    const original = sampled.entities.find((p) => p.id === sourceId)!;
    const a = placementWorld(sampled, original).position;
    const b = placementWorld(placed, insert.placement).position;
    const tracks = doc.sequence.tracks
      .filter((t) => t.target === from)
      .map((track) => {
        let delta = { x: 0, y: 0 };
        if (contract.properties[track.property]?.kind === "position") {
          const options = {
            frame: { x: 0, y: 0, width: view.width, height: view.height },
            fit: view.fit,
          };
          const x = clip.unmapPosition(track.id, a, options),
            y = clip.unmapPosition(track.id, b, options);
          delta = { x: y.x - x.x, y: y.y - x.y };
        }
        return {
          ...track,
          id: crypto.randomUUID(),
          target: to,
          keys: track.keys.map((k) => ({
            ...k,
            id: crypto.randomUUID(),
            value:
              contract.properties[track.property]?.kind === "position"
                ? {
                    x: (k.value as { x: number }).x + delta.x,
                    y: (k.value as { y: number }).y + delta.y,
                  }
                : k.value,
          })),
        };
      });
    sequence = {
      ...sequence,
      targets: { ...sequence.targets, [to]: contract },
      tracks: [...sequence.tracks.filter((t) => t.target !== to), ...tracks],
      events: [
        ...sequence.events,
        ...doc.sequence.events
          .filter((e) => e.target === from)
          .map((e) => ({ ...e, id: crypto.randomUUID(), target: to })),
      ],
    };
  }
  return {
    ...added,
    commands: [command, sequenceChange(doc, sequence, edit.after.bindings)],
  };
}

/** Change mapping representation while retaining the trajectory in this preview. */
export function remapSequenceTrack(
  state: EditorState,
  id: string,
  position: PositionMapping,
): SequenceTrack {
  const doc = state.document,
    view = state.sequence;
  if (doc.format !== "yage-sequence-workspace" || !view)
    throw new Error("No sequence workspace");
  const track = doc.sequence.tracks.find((t) => t.id === id);
  if (!track?.position) throw new Error("Choose a position track");
  const before = new SequenceClip(doc.sequence);
  const next = { ...track, position };
  const after = new SequenceClip({
    ...doc.sequence,
    tracks: doc.sequence.tracks.map((t) => (t.id === id ? next : t)),
  });
  const options = {
    frame: { x: 0, y: 0, width: view.width, height: view.height },
    fit: view.fit,
  };
  return {
    ...next,
    keys: track.keys.map((key) => {
      const sample = before
        .sample(key.frame, options)
        .find(
          (s) => s.target === track.target && s.property === track.property,
        )!;
      return {
        ...key,
        value: after.unmapPosition(
          id,
          sample.value as { x: number; y: number },
          options,
        ),
      };
    }),
  };
}
