import { Scene } from "@yagejs/core";
import { layers } from "./constants.js";
import {
  BackgroundEntity,
  HeroEntity,
  BlockEntity,
  GemEntity,
} from "./entities.js";
import { ToastEntity } from "./toast.js";
import { SidebarEntity } from "./sidebar.js";

export class ShowcaseScene extends Scene {
  readonly name = "effects-showcase";
  readonly layers = layers;

  // The scene only assembles the showcase. The sidebar's EffectControls
  // component attaches and removes the effects.
  onEnter(): void {
    this.spawn(BackgroundEntity);
    const hero = this.spawn(HeroEntity);
    const block = this.spawn(BlockEntity);
    const gem = this.spawn(GemEntity);
    const { toast } = this.spawn(ToastEntity);
    this.spawn(SidebarEntity, { hero, block, gem, toast });
  }
}
