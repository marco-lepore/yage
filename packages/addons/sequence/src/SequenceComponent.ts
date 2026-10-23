import { Component, ErrorBoundaryKey } from "@yagejs/core";
import { SequencePlayer } from "./core/SequencePlayer.js";
/** Scene-frame clock for one sequence instance. */
export class SequenceComponent extends Component {
  private instance: SequencePlayer | undefined;
  get player(): SequencePlayer {
    this.instance ??= new SequencePlayer(this.use(ErrorBoundaryKey));
    return this.instance;
  }
  update(dt: number): void {
    this.instance?.advance(dt);
  }
  onDestroy(): void {
    this.instance?.cancel("retain");
  }
}
