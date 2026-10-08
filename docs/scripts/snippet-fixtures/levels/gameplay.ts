import { Component, Entity } from "@yagejs/core";
import type { EntityHandle, Vec2 } from "@yagejs/core";
export declare class SlimeBrain extends Component {
  constructor(speed: number, facing: "left" | "right");
}
export declare class PatientBrain extends Component {
  constructor(patience: number);
}
export declare class Alarm extends Component {}
export declare class Patrol extends Component {
  constructor(end: Vec2);
}
export declare class Chest extends Component {
  constructor(item: string, count: number);
}
export declare class Spawner extends Component {
  queue(type: "slime" | "bat", delay: number): void;
}
export declare class Direction {
  static fromName(name: string): Direction;
}
export declare class Walk extends Component {
  constructor(facing: Direction);
}
export declare class Chime extends Entity {}
export declare class Door extends Entity {
  open(): void;
}
export declare class SwitchMechanism extends Component {
  constructor(door: EntityHandle<Entity>);
}
