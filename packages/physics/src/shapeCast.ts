import type RAPIER from "@dimforge/rapier2d";

// Parry 0.30.2 recomputes contact geometry below this TOI and drops the
// sweep's hit if that contact query fails. With a unit velocity, TOI is meters.
// https://github.com/dimforge/parry/blob/v0.30.2/src/query/shape_cast/shape_cast_support_map_support_map.rs#L31-L39
const NEAR_CONTACT = 1e-4;
const BACKSTEP = 2e-3;

/** Adapter for YAGE's unit-velocity, zero-target-distance shape sweeps. */
export function castShape(
  world: RAPIER.World,
  ...args: Parameters<RAPIER.World["castShape"]>
): ReturnType<RAPIER.World["castShape"]> {
  const hit = world.castShape(...args);
  if (hit?.time_of_impact === 0) return hit;

  const [origin, rotation, direction, shape, , maxDistance, stopAtPenetration] =
    args;
  const reach = Math.min(
    NEAR_CONTACT,
    maxDistance,
    hit?.time_of_impact ?? Infinity,
  );
  const predicate = args[11];
  const rejected = new Set<number>();
  args[0] = {
    x: origin.x - direction.x * BACKSTEP,
    y: origin.y - direction.y * BACKSTEP,
  };
  args[5] = BACKSTEP + reach;
  args[11] = (collider) =>
    !rejected.has(collider.handle) && (predicate?.(collider) ?? true);

  // Inspect the near interval even when the first sweep found a farther hit.
  // A collider entirely behind the original origin must not hide one ahead.
  for (;;) {
    const recovered = world.castShape(...args);
    if (!recovered || recovered.time_of_impact > BACKSTEP + reach) return hit;
    const distance = recovered.time_of_impact - BACKSTEP;
    if (distance >= 0) return { ...recovered, time_of_impact: distance };

    if (
      recovered.collider.intersectsShape(shape, origin, rotation) &&
      (stopAtPenetration ||
        recovered.normal1.x * direction.x + recovered.normal1.y * direction.y <
          0)
    ) {
      return { ...recovered, time_of_impact: 0 };
    }
    rejected.add(recovered.collider.handle);
  }
}
