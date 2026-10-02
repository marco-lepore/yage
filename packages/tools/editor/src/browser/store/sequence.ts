import { SequenceClip } from "@yagejs-addons/sequence";
import type { Point, SequenceSample } from "@yagejs-addons/sequence/document";
import type { EditorDocument } from "../../shared/document/index.js";
import { parentWorld, toLocal, toWorld } from "../../shared/document/pose.js";
import type { EditorState } from "./types.js";

export function sequenceSamples(state: EditorState): readonly SequenceSample[] {
  const doc = state.document,
    view = state.sequence;
  if (doc.format !== "yage-sequence-workspace" || !view) return [];
  return new SequenceClip(view.draft ?? doc.sequence).sample(
    Math.min(view.frame, doc.sequence.duration),
    {
      frame: { x: 0, y: 0, width: view.width, height: view.height },
      fit: view.fit,
    },
  );
}
/** Authored data sampled at the cursor, shared by preview and manipulation. */
export function sampledDocument(state: EditorState): EditorDocument {
  const doc = state.document;
  if (doc.format !== "yage-sequence-workspace" || !state.sequence) return doc;
  const samples = sequenceSamples(state);
  const positions = new Map<string, Point>();
  let entities = doc.entities.map((placement) => {
    let transform = placement.transform;
    for (const sample of samples) {
      if (doc.bindings[sample.target] !== placement.id) continue;
      const kind =
        doc.sequence.targets[sample.target]?.properties[sample.property]?.kind;
      if (sample.property === "position" && kind === "position")
        positions.set(placement.id, sample.value as Point);
      if (sample.property === "rotation" && kind === "number")
        transform = { ...transform, rotation: sample.value as number };
      if (sample.property === "scale" && kind === "vector")
        transform = { ...transform, scale: sample.value as Point };
    }
    return { ...placement, transform };
  });
  const byId = new Map(entities.map((p) => [p.id, p]));
  const done = new Set<string>();
  const visit = (id: string): void => {
    if (done.has(id)) return;
    done.add(id);
    const placement = byId.get(id);
    if (!placement) return;
    if (placement.parent) visit(placement.parent);
    const position = positions.get(id);
    if (!position) return;
    const projected = { ...doc, entities: [...byId.values()] };
    const parent = parentWorld(projected, placement.parent);
    const world = toWorld(placement.transform, parent);
    const local = toLocal({ ...world, position }, parent, placement.transform);
    byId.set(id, {
      ...placement,
      transform: { ...placement.transform, position: local.position },
    });
  };
  for (const p of entities) visit(p.id);
  entities = entities.map((p) => byId.get(p.id)!);
  return { ...doc, entities };
}
