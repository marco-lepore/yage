import {
  Scene,
  Component,
  Entity,
  Transform,
  Vec2,
  SceneManagerKey,
} from "@yagejs/core";
import { GraphicsComponent, type GraphicsContext } from "@yagejs/renderer";
import { UIRoot, Anchor } from "@yagejs/ui-react";
import { InputManagerKey } from "@yagejs/input";
import type { SlotInfo } from "@yagejs/save";
import { allAssets } from "../shared/ui-theme.js";
import { game, newRun, type RunMeta } from "./stores.js";
import { SaveSlots } from "./slots.js";
import {
  MainMenuPanel,
  GameplayHUD,
  GameplayActions,
  PauseMenuPanel,
  SettingsPanel,
} from "./menus.js";

// ---------------------------------------------------------------------------
// 5. MenuScene — root scene; hosts the main menu.
// ---------------------------------------------------------------------------

/** What the main menu's buttons do. The slot list is the sibling SaveSlots. */
export class MainMenu extends Component {
  private readonly scenes = this.service(SceneManagerKey);
  private readonly slots = this.sibling(SaveSlots);

  newGame(): void {
    newRun();
    void this.scenes.replace(new GameplayScene());
  }

  /** Load `slot` into the run, then play it. */
  async continueFrom(slot: SlotInfo<RunMeta>): Promise<void> {
    await this.slots.load(slot);
    await this.scenes.replace(new GameplayScene());
  }

  openSettings(): void {
    void this.scenes.replace(new SettingsScene());
  }
}

class MainMenuEntity extends Entity {
  setup(): void {
    const slots = this.add(new SaveSlots());
    const menu = this.add(new MainMenu());
    this.add(new UIRoot({ anchor: Anchor.Center })).render(
      <MainMenuPanel menu={menu} slots={slots} />,
    );
  }
}

export class MenuScene extends Scene {
  readonly name = "save-stores.menu";
  readonly preload = allAssets;

  onEnter(): void {
    this.spawn(MainMenuEntity);
  }
}

// ---------------------------------------------------------------------------
// 6. GameplayScene — coin sprite + HUD + Pause overlay on Esc.
// ---------------------------------------------------------------------------

function drawCoin(g: GraphicsContext, coins: number): void {
  g.clear();
  const scale = Math.min(1 + coins * 0.04, 3);
  const r = 36 * scale;
  g.circle(0, 0, r).fill({ color: 0xfacc15 });
  g.circle(0, 0, r).stroke({ color: 0xeab308, width: 3 });
  g.circle(0, 0, r * 0.45).stroke({ color: 0xb45309, width: 2 });
}

/** Redraws the coin, larger the more coins the run holds. */
class CoinDisplay extends Component {
  private readonly graphics = this.sibling(GraphicsComponent);

  onAdd(): void {
    this.redraw();
    // Subscribe to the leaf rather than the whole compound, so changes to
    // other leaves do not redraw the coin.
    this.addCleanup(game.progression.subscribe(() => this.redraw()));
  }

  private redraw(): void {
    const { coins } = game.progression.get();
    this.graphics.draw((g) => drawCoin(g, coins));
  }
}

class CoinEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(400, 300) }));
    this.add(new GraphicsComponent());
    this.add(new CoinDisplay());
  }
}

/** Opens the pause menu when Escape is pressed. */
class PauseOnEscape extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly scenes = this.service(SceneManagerKey);

  update(): void {
    if (this.input.isJustPressed("Escape")) {
      void this.scenes.push(new PauseScene());
    }
  }
}

/** The run's stats at the top left, the action bar at the bottom, and
 *  Escape to pause. */
class GameplayUIEntity extends Entity {
  setup(): void {
    this.add(new PauseOnEscape());
    this.spawnChild("hud")
      .add(new UIRoot({ anchor: Anchor.TopLeft }))
      .render(<GameplayHUD />);
    this.spawnChild("actions")
      .add(new UIRoot({ anchor: Anchor.BottomCenter }))
      .render(<GameplayActions />);
  }
}

class GameplayScene extends Scene {
  readonly name = "save-stores.gameplay";
  readonly preload = allAssets;

  onEnter(): void {
    this.spawn(CoinEntity);
    this.spawn(GameplayUIEntity);
  }
}

// ---------------------------------------------------------------------------
// 7. PauseScene — overlay; saves through SaveSlots.
// ---------------------------------------------------------------------------

/** What the pause menu's buttons do. Escape resumes too. */
export class PauseMenu extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly scenes = this.service(SceneManagerKey);

  update(): void {
    if (this.input.isJustPressed("Escape")) this.resume();
  }

  resume(): void {
    void this.scenes.pop();
  }

  /** Close the pause menu and the run below it, and open the main menu. */
  async quitToMenu(): Promise<void> {
    await this.scenes.pop();
    await this.scenes.replace(new MenuScene());
  }
}

class PauseMenuEntity extends Entity {
  setup(): void {
    const slots = this.add(new SaveSlots());
    const menu = this.add(new PauseMenu());
    this.add(new UIRoot({ anchor: Anchor.Center })).render(
      <PauseMenuPanel menu={menu} slots={slots} />,
    );
  }
}

class PauseScene extends Scene {
  readonly name = "save-stores.pause";
  readonly preload = allAssets;
  readonly transparentBelow = true;

  onEnter(): void {
    const dim = this.spawn("pause-dim");
    dim.add(new Transform({ position: new Vec2(400, 300) }));
    dim.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-400, -300, 800, 600).fill({ color: 0x000000, alpha: 0.55 });
      }),
    );
    this.spawn(PauseMenuEntity);
  }
}

// ---------------------------------------------------------------------------
// 8. SettingsScene — volume steps and a checkbox; each change auto-persists.
// ---------------------------------------------------------------------------

export class SettingsMenu extends Component {
  private readonly scenes = this.service(SceneManagerKey);

  back(): void {
    void this.scenes.replace(new MenuScene());
  }
}

class SettingsMenuEntity extends Entity {
  setup(): void {
    const menu = this.add(new SettingsMenu());
    this.add(new UIRoot({ anchor: Anchor.Center })).render(
      <SettingsPanel menu={menu} />,
    );
  }
}

class SettingsScene extends Scene {
  readonly name = "save-stores.settings";
  readonly preload = allAssets;

  onEnter(): void {
    this.spawn(SettingsMenuEntity);
  }
}
