import { ServiceKey } from "@yage/core";

/** Service key for the InputManager. */
export const InputManagerKey = new ServiceKey<
  import("./InputManager.js").InputManager
>("inputManager");

/** Configuration for the InputPlugin. */
export interface InputConfig {
  /** Target element for pointer events (default: canvas from RendererPlugin, or document). */
  target?: HTMLElement;
  /** Action map: action name -> array of physical key codes. */
  actions?: ActionMapDefinition;
  /** Key codes to call preventDefault() on (default: none). */
  preventDefaultKeys?: string[];
}

/** Maps action names to arrays of physical key codes. */
export interface ActionMapDefinition {
  [actionName: string]: string[];
}
