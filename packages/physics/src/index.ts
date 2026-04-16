export { VERSION } from "@yagejs/core";

export { PhysicsWorldManagerKey, PhysicsWorldKey } from "./types.js";
export type {
  BodyType,
  PhysicsConfig,
  PhysicsAlphaRef,
  ScenePhysicsContext,
  RigidBodyConfig,
  ColliderShape,
  ColliderConfig,
  CollisionEvent,
  TriggerEvent,
  RaycastHit,
} from "./types.js";

export { CollisionLayers } from "./CollisionLayers.js";

export { PhysicsWorld } from "./PhysicsWorld.js";

export { PhysicsWorldManager } from "./PhysicsWorldManager.js";

export { RigidBodyComponent } from "./RigidBodyComponent.js";
export type { RigidBodyData } from "./RigidBodyComponent.js";

export { ColliderComponent } from "./ColliderComponent.js";
export type { ColliderData } from "./ColliderComponent.js";

export { PhysicsSystem } from "./PhysicsSystem.js";

export { PhysicsInterpolationSystem } from "./PhysicsInterpolationSystem.js";

export { PhysicsPlugin } from "./PhysicsPlugin.js";
