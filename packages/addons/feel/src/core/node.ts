import type {
  FeelEffectContext,
  FeelEffectDefinition,
  FeelEffectInstance,
  FeelNode,
  ScheduledFeelEffect,
} from "./types.js";

function validDuration(duration: number, label: string): number {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(
      `${label}: duration must be a finite number >= 0, got ${duration}.`,
    );
  }
  return duration;
}

class EffectNode implements FeelNode {
  readonly duration: number;

  constructor(private readonly definition: FeelEffectDefinition) {
    this.duration = validDuration(definition.duration, "defineFeelEffect");
  }

  _schedule(at: number, output: ScheduledFeelEffect[]): void {
    output.push({ at, definition: this.definition });
  }
}

class GroupNode implements FeelNode {
  constructor(
    readonly duration: number,
    private readonly schedule: (
      at: number,
      output: ScheduledFeelEffect[],
    ) => void,
  ) {}

  _schedule(at: number, output: ScheduledFeelEffect[]): void {
    this.schedule(at, output);
  }
}

/** Define one timed effect leaf. */
export function defineFeelEffect(
  duration: number,
  create: (context: FeelEffectContext) => FeelEffectInstance,
): FeelNode {
  return new EffectNode({ duration, create });
}

/** Run every child at the same time. */
export function feelParallel(...nodes: readonly FeelNode[]): FeelNode {
  const duration = nodes.reduce((max, node) => Math.max(max, node.duration), 0);
  return new GroupNode(duration, (at, output) => {
    for (const node of nodes) node._schedule(at, output);
  });
}

/** Run each child after the previous child finishes. */
export function feelSequence(...nodes: readonly FeelNode[]): FeelNode {
  const duration = nodes.reduce((sum, node) => sum + node.duration, 0);
  return new GroupNode(duration, (at, output) => {
    let cursor = at;
    for (const node of nodes) {
      node._schedule(cursor, output);
      cursor += node.duration;
    }
  });
}

/** Delay a node, or create an empty wait when no node is supplied. */
export function feelDelay(seconds: number, node?: FeelNode): FeelNode {
  const delay = validDuration(seconds, "feelDelay");
  if (!node) return new GroupNode(delay, () => {});
  return new GroupNode(delay + node.duration, (at, output) => {
    node._schedule(at + delay, output);
  });
}

/** Repeat a node a fixed number of times with an optional gap. */
export function feelRepeat(node: FeelNode, times: number, gap = 0): FeelNode {
  if (!Number.isInteger(times) || times < 0) {
    throw new Error(`feelRepeat: times must be an integer >= 0, got ${times}.`);
  }
  const delay = validDuration(gap, "feelRepeat");
  const duration =
    times === 0 ? 0 : node.duration * times + delay * (times - 1);
  return new GroupNode(duration, (at, output) => {
    for (let index = 0; index < times; index++) {
      node._schedule(at + index * (node.duration + delay), output);
    }
  });
}
