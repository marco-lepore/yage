import type { SequencePropertyBinding } from "./SequencePlayer.js";

/**
 * Key of an optional method on a property binding that returns its write
 * order. The player writes lower orders first; a binding without one is 0.
 */
export const sequenceWriteOrder = Symbol("sequence write order");
export interface OrderedSequenceProperty extends SequencePropertyBinding {
  readonly [sequenceWriteOrder]?: () => number;
}
export function propertyWriteOrder(binding: SequencePropertyBinding): number {
  return (binding as OrderedSequenceProperty)[sequenceWriteOrder]?.() ?? 0;
}
