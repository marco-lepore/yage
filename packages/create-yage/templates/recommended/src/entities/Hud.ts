import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { TextComponent } from "@yagejs/renderer";
import { CoinCollected } from "../events";

/** Spawn key of the HUD entity, for `scene.findByKey`. */
export const HUD_KEY = "hud";

/** The coins collected this run. Starts at zero each time the scene starts. */
export class CoinCounter extends Component {
  private readonly text = this.sibling(TextComponent);
  private _coins = 0;

  get coins(): number {
    return this._coins;
  }

  onAdd(): void {
    this.refresh();
    // Each coin emits CoinCollected on itself; the event bubbles to the scene.
    this.listenScene(CoinCollected, () => {
      this._coins += 1;
      this.refresh();
    });
  }

  private refresh(): void {
    this.text.setText(`Coins: ${this._coins}`);
  }
}

/**
 * The coin counter in the top-left corner, on the screen-space "hud" layer.
 * Other code reads the count with
 * `scene.findByKey<Hud>(HUD_KEY)?.counter.coins`.
 */
export class Hud extends Entity {
  counter!: CoinCounter;

  setup(): void {
    // On a screen-space layer, the position is in screen pixels.
    this.add(new Transform({ position: new Vec2(16, 12) }));
    this.add(
      new TextComponent({
        text: "",
        layer: "hud",
        style: { fontFamily: "monospace", fontSize: 18, fill: 0xfacc15 },
      }),
    );
    this.counter = this.add(new CoinCounter());
  }
}
