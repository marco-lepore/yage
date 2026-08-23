import { Transform, Vec2, type Vec2Like } from "@yagejs/core";

interface MotionContribution {
  position: Vec2;
  rotation: number;
  scale: Vec2;
}

interface MotionState {
  basePosition: Vec2;
  baseRotation: number;
  baseScale: Vec2;
  lastPosition: Vec2;
  lastRotation: number;
  lastScale: Vec2;
  contributions: Map<symbol, MotionContribution>;
}

export interface MotionContributionHandle {
  setPosition(offset: Vec2Like): void;
  setRotation(offset: number): void;
  setScale(factor: Vec2Like): void;
  remove(): void;
}

const states = new WeakMap<Transform, MotionState>();
const EPSILON = 1e-8;

export function addMotionContribution(
  target: Transform,
): MotionContributionHandle {
  let state = states.get(target);
  if (!state) {
    state = {
      basePosition: target.position,
      baseRotation: target.rotation,
      baseScale: target.scale,
      lastPosition: Vec2.ZERO,
      lastRotation: 0,
      lastScale: Vec2.ONE,
      contributions: new Map(),
    };
    states.set(target, state);
  } else {
    rebase(target, state);
  }

  const id = Symbol("feel.motion");
  state.contributions.set(id, {
    position: Vec2.ZERO,
    rotation: 0,
    scale: Vec2.ONE,
  });
  apply(target, state);
  let active = true;

  const mutate = (callback: (value: MotionContribution) => void): void => {
    if (!active) return;
    const current = states.get(target);
    const value = current?.contributions.get(id);
    if (!current || !value) return;
    rebase(target, current);
    callback(value);
    apply(target, current);
  };

  return {
    setPosition: (offset) => {
      mutate((value) => {
        value.position = new Vec2(offset.x, offset.y);
      });
    },
    setRotation: (offset) => {
      mutate((value) => {
        value.rotation = offset;
      });
    },
    setScale: (factor) => {
      mutate((value) => {
        value.scale = new Vec2(factor.x, factor.y);
      });
    },
    remove: () => {
      if (!active) return;
      active = false;
      const current = states.get(target);
      if (!current) return;
      rebase(target, current);
      current.contributions.delete(id);
      apply(target, current);
      if (current.contributions.size === 0) states.delete(target);
    },
  };
}

function rebase(target: Transform, state: MotionState): void {
  state.basePosition = target.position.sub(state.lastPosition);
  state.baseRotation = target.rotation - state.lastRotation;
  state.baseScale = new Vec2(
    Math.abs(state.lastScale.x) < EPSILON
      ? state.baseScale.x
      : target.scale.x / state.lastScale.x,
    Math.abs(state.lastScale.y) < EPSILON
      ? state.baseScale.y
      : target.scale.y / state.lastScale.y,
  );
}

function apply(target: Transform, state: MotionState): void {
  let position = Vec2.ZERO;
  let rotation = 0;
  let scale = Vec2.ONE;
  for (const contribution of state.contributions.values()) {
    position = position.add(contribution.position);
    rotation += contribution.rotation;
    scale = scale.multiply(contribution.scale);
  }
  state.lastPosition = position;
  state.lastRotation = rotation;
  state.lastScale = scale;
  target.position = state.basePosition.add(position);
  target.rotation = state.baseRotation + rotation;
  target.scale = state.baseScale.multiply(scale);
}
