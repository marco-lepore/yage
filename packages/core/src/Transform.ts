import { Component } from "./Component.js";
import { Vec2 } from "./Vec2.js";

/** Mutable transform component for entity positioning. */
export class Transform extends Component {
  /** Position in world coordinates. */
  position: Vec2;
  /** Rotation in radians. */
  rotation: number;
  /** Scale factor. */
  scale: Vec2;

  constructor(options?: {
    position?: Vec2;
    rotation?: number;
    scale?: Vec2;
  }) {
    super();
    this.position = options?.position ?? Vec2.ZERO;
    this.rotation = options?.rotation ?? 0;
    this.scale = options?.scale ?? Vec2.ONE;
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
