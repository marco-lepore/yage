import { useEffect, useState } from "react";
import {
  Scene,
  Component,
  Transform,
  Vec2,
  SceneManagerKey,
} from "@yagejs/core";
import { GraphicsComponent, type GraphicsContext } from "@yagejs/renderer";
import { UIRoot, Anchor, useScene } from "@yagejs/ui-react";
import { InputManagerKey } from "@yagejs/input";
import { SaveServiceKey, type SlotInfo } from "@yagejs/save";
import { allAssets } from "../shared/ui-theme.js";
import {
  game,
  save,
  GAME_ID,
  newRun,
  snapshotRunMeta,
  type RunMeta,
  type SlotName,
} from "./stores.js";
import {
  MainMenuPanel,
  GameplayHUD,
  GameplayActions,
  PauseMenuPanel,
  SettingsPanel,
} from "./menus.js";

// ---------------------------------------------------------------------------
// 4. MenuScene — root scene; hosts main menu UI.
// ---------------------------------------------------------------------------

export class MenuScene extends Scene {
  readonly name = "save-stores.menu";
  readonly preload = allAssets;

  onEnter(): void {
    const ui = this.spawn("menu-ui");
    const root = ui.add(new UIRoot({ anchor: Anchor.Center }));
    const sm = this.context.resolve(SceneManagerKey);
    const startGame = (loadSlot?: SlotInfo<RunMeta>): void => {
      void (async () => {
        if (loadSlot) {
          await save.loadSlot(GAME_ID, loadSlot.name, game);
        } else {
          newRun();
        }
        await sm.replace(new GameplayScene());
      })();
    };
    const openSettings = (): void => {
      void sm.replace(new SettingsScene());
    };

    root.render(
      <MainMenuPanel
        onStartNew={() => startGame()}
        onContinue={(slot) => startGame(slot)}
        onDeleteSlot={async (slot) => {
          await save.deleteSlot(GAME_ID, slot.name);
        }}
        onOpenSettings={openSettings}
      />,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. GameplayScene — coin sprite + HUD + Pause overlay on Esc.
// ---------------------------------------------------------------------------

class CoinDisplay extends Component {
  static draw(g: GraphicsContext, coins: number): void {
    g.clear();
    const scale = Math.min(1 + coins * 0.04, 3);
    const r = 36 * scale;
    g.circle(0, 0, r).fill({ color: 0xfacc15 });
    g.circle(0, 0, r).stroke({ color: 0xeab308, width: 3 });
    g.circle(0, 0, r * 0.45).stroke({ color: 0xb45309, width: 2 });
  }

  private graphics = this.sibling(GraphicsComponent);
  private unsub: (() => void) | null = null;

  onAdd(): void {
    const apply = (): void => {
      this.graphics.draw((g) => CoinDisplay.draw(g, game.progression.get().coins));
    };
    apply();
    // Subscribe to the leaf rather than the whole compound — keeps the redraw
    // out of the path of unrelated leaves' mutations.
    this.unsub = game.progression.subscribe(apply);
  }

  onRemove(): void {
    this.unsub?.();
    this.unsub = null;
  }
}

class PauseToggleComponent extends Component {
  private input = this.service(InputManagerKey);
  private scenes = this.service(SceneManagerKey);

  update(): void {
    if (this.input.isJustPressed("Escape")) {
      void this.scenes.push(new PauseScene());
    }
  }
}

class GameplayScene extends Scene {
  readonly name = "save-stores.gameplay";
  readonly preload = allAssets;

  onEnter(): void {
    const coin = this.spawn("coin-display");
    coin.add(new Transform({ position: new Vec2(400, 300) }));
    coin.add(new GraphicsComponent());
    coin.add(new CoinDisplay());

    const pauseToggle = this.spawn("pause-toggle");
    pauseToggle.add(new Transform());
    pauseToggle.add(new PauseToggleComponent());

    const hud = this.spawn("hud");
    hud.add(new UIRoot({ anchor: Anchor.TopLeft })).render(<GameplayHUD />);

    const actions = this.spawn("actions");
    actions.add(new UIRoot({ anchor: Anchor.BottomCenter })).render(<GameplayActions />);
  }
}

// ---------------------------------------------------------------------------
// 6. PauseScene — overlay; saves through SaveServiceKey from a Component.
// ---------------------------------------------------------------------------

class PauseSaveComponent extends Component {
  private save = this.service(SaveServiceKey);
  private input = this.service(InputManagerKey);
  private scenes = this.service(SceneManagerKey);
  private bumpRefresh: (() => void) | null = null;

  setRefreshHook(bump: () => void): void {
    this.bumpRefresh = bump;
  }

  async saveSlot(name: SlotName): Promise<void> {
    await this.save.saveSlot<unknown, RunMeta>(GAME_ID, name, game, {
      metadata: snapshotRunMeta(name),
    });
    this.bumpRefresh?.();
  }

  update(): void {
    if (this.input.isJustPressed("Escape")) {
      void this.scenes.pop();
    }
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

    const pauseEntity = this.spawn("pause-host");
    pauseEntity.add(new Transform());
    const pauseComp = pauseEntity.add(new PauseSaveComponent());

    const ui = this.spawn("pause-ui");
    const root = ui.add(new UIRoot({ anchor: Anchor.Center }));

    const sm = this.context.resolve(SceneManagerKey);

    function PauseRoot() {
      const [refreshKey, setRefreshKey] = useState(0);
      useEffect(() => {
        const bump = (): void => setRefreshKey((k) => k + 1);
        pauseComp.setRefreshHook(bump);
      }, []);
      const goMainMenu = (): void => {
        void (async () => {
          await sm.pop();
          await sm.replace(new MenuScene());
        })();
      };
      const onResume = (): void => {
        void sm.pop();
      };
      return (
        <PauseMenuPanel
          onResume={onResume}
          onSave={(name) => pauseComp.saveSlot(name)}
          onMainMenu={goMainMenu}
          refreshKey={refreshKey}
        />
      );
    }
    root.render(<PauseRoot />);
  }
}

// ---------------------------------------------------------------------------
// 7. SettingsScene — sliders/checkbox; auto-persists via subscribe.
// ---------------------------------------------------------------------------

class SettingsScene extends Scene {
  readonly name = "save-stores.settings";
  readonly preload = allAssets;

  onEnter(): void {
    const ui = this.spawn("settings-ui");
    const root = ui.add(new UIRoot({ anchor: Anchor.Center }));

    function SettingsRoot() {
      const scene = useScene();
      const onBack = (): void => {
        void scene.context.resolve(SceneManagerKey).replace(new MenuScene());
      };
      return <SettingsPanel onBack={onBack} />;
    }

    root.render(<SettingsRoot />);
  }
}
