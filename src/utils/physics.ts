import { QueryFilterFlags } from '@dimforge/rapier2d'

export enum QueryFilterFlagsFixed {
  /**
   * Exclude from the query any collider attached to a fixed rigid-body and colliders with no rigid-body attached.
   */
  EXCLUDE_FIXED = 1 << 1,
  /**
   * Exclude from the query any collider attached to a dynamic rigid-body.
   */
  EXCLUDE_KINEMATIC = 1 << 2,
  /**
   * Exclude from the query any collider attached to a kinematic rigid-body.
   */
  EXCLUDE_DYNAMIC = 1 << 3,
  /**
   * Exclude from the query any collider that is a sensor.
   */
  EXCLUDE_SENSORS = 1 << 4,
  /**
   * Exclude from the query any collider that is not a sensor.
   */
  EXCLUDE_SOLIDS = 1 << 5,
  /**
   * Excludes all colliders not attached to a dynamic rigid-body.
   */
  ONLY_DYNAMIC = QueryFilterFlagsFixed.EXCLUDE_FIXED |
    QueryFilterFlagsFixed.EXCLUDE_KINEMATIC,
  /**
   * Excludes all colliders not attached to a kinematic rigid-body.
   */
  ONLY_KINEMATIC = QueryFilterFlagsFixed.EXCLUDE_DYNAMIC |
    QueryFilterFlagsFixed.EXCLUDE_FIXED,
  /**
   * Exclude all colliders attached to a non-fixed rigid-body
   * (this will not exclude colliders not attached to any rigid-body).
   */
  ONLY_FIXED = QueryFilterFlagsFixed.EXCLUDE_DYNAMIC |
    QueryFilterFlagsFixed.EXCLUDE_KINEMATIC,
}
