import { Component } from "./Component.js";
import { Vec2 } from "./Vec2.js";
import type { Vec2Like } from "./Vec2.js";

/** Mutable transform component for entity positioning. */
export class Transform extends Component {
  /** Local position (relative to parent, or world if no parent). */
  position: Vec2;
  /** Local rotation in radians. */
  rotation: number;
  /** Local scale factor. */
  scale: Vec2;

  /** Computed world position. Updated by TransformPropagationSystem. */
  worldPosition: Vec2;
  /** Computed world rotation. Updated by TransformPropagationSystem. */
  worldRotation: number;
  /** Computed world scale. Updated by TransformPropagationSystem. */
  worldScale: Vec2;

  constructor(options?: {
    position?: Vec2Like;
    rotation?: number;
    scale?: Vec2Like;
  }) {
    super();
    this.position = options?.position
      ? new Vec2(options.position.x, options.position.y)
      : Vec2.ZERO;
    this.rotation = options?.rotation ?? 0;
    this.scale = options?.scale
      ? new Vec2(options.scale.x, options.scale.y)
      : Vec2.ONE;
    this.worldPosition = this.position;
    this.worldRotation = this.rotation;
    this.worldScale = this.scale;
  }

  /** Set position directly. */
  setPosition(x: number, y: number): void {
    this.position = new Vec2(x, y);
  }

  /** Translate by an offset. */
  translate(dx: number, dy: number): void {
    this.position = new Vec2(this.position.x + dx, this.position.y + dy);
  }

  /** Set rotation in radians. */
  setRotation(radians: number): void {
    this.rotation = radians;
  }

  /** Rotate by a delta in radians. */
  rotate(deltaRadians: number): void {
    this.rotation += deltaRadians;
  }

  /** Set scale. */
  setScale(x: number, y: number): void {
    this.scale = new Vec2(x, y);
  }
}
