import { CollisionLayers } from "@yage/physics";

const layers = new CollisionLayers();
export const LAYER_PLAYER = layers.define("player");
export const LAYER_PLATFORM = layers.define("platform");
export const LAYER_COIN = layers.define("coin");
export const LAYER_HAZARD = layers.define("hazard");
