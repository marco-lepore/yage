interface NumberContribution {
  value: number;
}

interface NumberState {
  base: number;
  last: number;
  mode: "add" | "multiply";
  get(): number;
  set(value: number): void;
  contributions: Map<symbol, NumberContribution>;
}

export interface NumberContributionHandle {
  set(value: number): void;
  remove(): void;
}

const targets = new WeakMap<object, Map<string, NumberState>>();
const EPSILON = 1e-8;

export function addNumberContribution(
  target: object,
  channel: string,
  mode: "add" | "multiply",
  get: () => number,
  set: (value: number) => void,
): NumberContributionHandle {
  let channels = targets.get(target);
  if (!channels) {
    channels = new Map();
    targets.set(target, channels);
  }
  let state = channels.get(channel);
  if (!state) {
    state = {
      base: get(),
      last: mode === "add" ? 0 : 1,
      mode,
      get,
      set,
      contributions: new Map(),
    };
    channels.set(channel, state);
  } else if (state.mode !== mode) {
    throw new Error(
      `Feel number channel "${channel}" cannot mix additive and multiplicative values.`,
    );
  } else {
    rebase(state);
  }

  const id = Symbol(`feel.${channel}`);
  state.contributions.set(id, { value: mode === "add" ? 0 : 1 });
  apply(state);
  let active = true;

  return {
    set: (value) => {
      if (!active) return;
      const current = channels?.get(channel);
      const contribution = current?.contributions.get(id);
      if (!current || !contribution) return;
      rebase(current);
      contribution.value = value;
      apply(current);
    },
    remove: () => {
      if (!active) return;
      active = false;
      const current = channels?.get(channel);
      if (!current) return;
      rebase(current);
      current.contributions.delete(id);
      apply(current);
      if (current.contributions.size === 0) {
        channels?.delete(channel);
        if (channels?.size === 0) targets.delete(target);
      }
    },
  };
}

function rebase(state: NumberState): void {
  const current = state.get();
  state.base =
    state.mode === "add"
      ? current - state.last
      : Math.abs(state.last) < EPSILON
        ? state.base
        : current / state.last;
}

function apply(state: NumberState): void {
  let aggregate = state.mode === "add" ? 0 : 1;
  for (const contribution of state.contributions.values()) {
    aggregate =
      state.mode === "add"
        ? aggregate + contribution.value
        : aggregate * contribution.value;
  }
  state.last = aggregate;
  state.set(
    state.mode === "add" ? state.base + aggregate : state.base * aggregate,
  );
}
