type AnimationSpeedOwner = (value: number) => void;

const speedOwners = new WeakMap<object, AnimationSpeedOwner>();
const bypassedControllers = new WeakSet<object>();

export function registerAnimationSpeedOwner(
  controllers: readonly object[],
  owner: AnimationSpeedOwner,
): () => void {
  for (const controller of controllers) {
    if (speedOwners.has(controller)) {
      throw new Error(
        "An AnimationController cannot belong to more than one LayeredAnimationController.",
      );
    }
  }
  for (const controller of controllers) speedOwners.set(controller, owner);
  return () => {
    for (const controller of controllers) {
      if (speedOwners.get(controller) === owner) {
        speedOwners.delete(controller);
      }
    }
  };
}

export function routeAnimationSpeedChange(
  controller: object,
  value: number,
): boolean {
  if (bypassedControllers.has(controller)) return false;
  const owner = speedOwners.get(controller);
  if (!owner) return false;
  owner(value);
  return true;
}

export function withoutAnimationSpeedOwner<T>(
  controller: object,
  fn: () => T,
): T {
  bypassedControllers.add(controller);
  try {
    return fn();
  } finally {
    bypassedControllers.delete(controller);
  }
}
