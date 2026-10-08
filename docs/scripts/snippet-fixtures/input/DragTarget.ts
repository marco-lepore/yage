import { Component } from "@yagejs/core";
import type { Vec2 } from "@yagejs/core";
import type { PointerInfo } from "@yagejs/input";
export declare class DragTarget extends Component {
  contains(position: Vec2): boolean;
  startDrag(pointer: PointerInfo): void;
}
