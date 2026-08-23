interface BooleanContribution {
  value: boolean;
}

interface BooleanState {
  base: boolean;
  last: boolean;
  get(): boolean;
  set(value: boolean): void;
  contributions: Map<symbol, BooleanContribution>;
}

export interface BooleanContributionHandle {
  set(value: boolean): void;
  remove(): void;
}

const targets = new WeakMap<object, Map<string, BooleanState>>();

export function addBooleanContribution(
  target: object,
  channel: string,
  get: () => boolean,
  set: (value: boolean) => void,
): BooleanContributionHandle {
  let channels = targets.get(target);
  if (!channels) {
    channels = new Map();
    targets.set(target, channels);
  }
  let state = channels.get(channel);
  if (!state) {
    state = {
      base: get(),
      last: get(),
      get,
      set,
      contributions: new Map(),
    };
    channels.set(channel, state);
  } else {
    rebase(state);
  }

  const id = Symbol(`feel.${channel}`);
  state.contributions.set(id, { value: true });
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

function rebase(state: BooleanState): void {
  const current = state.get();
  if (current !== state.last) state.base = current;
}

function apply(state: BooleanState): void {
  let visible = state.base;
  for (const contribution of state.contributions.values()) {
    visible &&= contribution.value;
  }
  state.last = visible;
  state.set(visible);
}
