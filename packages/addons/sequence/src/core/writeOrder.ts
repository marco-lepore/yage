import type { SequencePropertyBinding } from "./SequencePlayer.js";

/** Internal accessor metadata; no registry or hierarchy is stored by the player. */
export const sequenceWriteOrder = Symbol("sequence write order");
export interface OrderedSequenceProperty extends SequencePropertyBinding {
  readonly [sequenceWriteOrder]?: () => number;
}
export function propertyWriteOrder(binding: SequencePropertyBinding): number {
  return (binding as OrderedSequenceProperty)[sequenceWriteOrder]?.() ?? 0;
}
