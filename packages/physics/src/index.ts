export { VERSION } from "@yage/core";

export { PhysicsWorldKey } from "./types.js";
export type {
  BodyType,
  PhysicsConfig,
  RigidBodyConfig,
  ColliderShape,
  ColliderConfig,
  CollisionEvent,
  TriggerEvent,
  RaycastHit,
} from "./types.js";

export { CollisionLayers } from "./CollisionLayers.js";

export { PhysicsWorld } from "./PhysicsWorld.js";

export { RigidBodyComponent } from "./RigidBodyComponent.js";
export type { RigidBodyData } from "./RigidBodyComponent.js";

export { ColliderComponent } from "./ColliderComponent.js";
export type { ColliderData } from "./ColliderComponent.js";

export { PhysicsSystem } from "./PhysicsSystem.js";

export { PhysicsInterpolationSystem } from "./PhysicsInterpolationSystem.js";

export { PhysicsPlugin } from "./PhysicsPlugin.js";

export { toRapierColliders } from "./toRapierColliders.js";
export type { RapierModule, RapierColliderDesc } from "./toRapierColliders.js";
