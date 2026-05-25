/**
 * Save Stores example
 *
 * A small "real" game with menu / gameplay / settings / pause scenes, where
 * every persistence call goes through the engine's DI: the React UI binds to
 * leaves via `useStore`, and the scenes' own Components resolve the
 * registered Save instance through `SaveServiceKey`.
 *
 * This example showcases the **compound** store pattern: a single
 * `createStore((s) => …)` bundles every run-state leaf (counters,
 * a record, a value), and a separate compound stores settings. Two
 * `save.autoPersist(id, store)` registrations cover the whole game state —
 * one storage key per compound — with atomic serialize/hydrate.
 */

import { useEffect, useState } from "react";
import {
  Engine,
  Scene,
  Component,
  Transform,
  Vec2,
  SceneManagerKey,
  createStore,
} from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  type GraphicsContext,
} from "@yagejs/renderer";
import { UIPlugin } from "@yagejs/ui";
import {
  UIReactPlugin,
  UIRoot,
  Panel,
  Text,
  Button,
  Checkbox,
  PixiProgressBar,
  Anchor,
  useStore,
  useScene,
} from "@yagejs/ui-react";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import {
  createSave,
  SavePlugin,
  SaveServiceKey,
  localStorageAdapter,
  type SlotInfo,
  type Save,
} from "@yagejs/save";
import {
  textStyle,
  loadFonts,
  allAssets,
  nineSliceBtnReact,
  panelBg,
  sprites as S,
  nineSlice,
} from "./ui-theme.js";
import { injectStyles, setupGameContainer } from "./shared.js";

injectStyles();

// ---------------------------------------------------------------------------
// 1. Compound stores
//
// `game` collects every run-state leaf into one save document. `settings` is
// its own compound because it persists separately (across runs).
// ---------------------------------------------------------------------------

const GAME_ID = "save-stores.run";
const SETTINGS_ID = "save-stores.settings";

const game = createStore((s) => ({
  progression: s.record<{ chapter: number; coins: number }>({
    default: () => ({ chapter: 1, coins: 0 }),
  }),
  deaths: s.counter({ default: 0 }),
}));

const settings = createStore((s) => ({
  audio: s.record<{ music: number; sfx: number }>({
    default: () => ({ music: 0.8, sfx: 1.0 }),
  }),
  vsync: s.value<boolean>({ default: true }),
}));

interface RunMeta {
  chapter: number;
  coins: number;
  deaths: number;
  label?: string;
}

// ---------------------------------------------------------------------------
// 2. Save instance — created in user code, registered via SavePlugin.
// ---------------------------------------------------------------------------

const save = createSave({
  adapter: localStorageAdapter({ namespace: "yage-save-stores-example" }),
});

function snapshotRunMeta(label?: string): RunMeta {
  const p = game.progression.get();
  const meta: RunMeta = {
    chapter: p.chapter,
    coins: p.coins,
    deaths: game.deaths.value(),
  };
  if (label !== undefined) meta.label = label;
  return meta;
}

function newRun(): void {
  game.reset();
}

// `useSlots` re-reads `save.listSlots(id)` whenever `refreshKey` bumps
// (called explicitly from save/delete handlers).
function useSlots(
  saveInstance: Save,
  id: string,
  refreshKey: number,
): SlotInfo<RunMeta>[] {
  const [slots, setSlots] = useState<SlotInfo<RunMeta>[]>([]);
  useEffect(() => {
    let cancelled = false;
    void saveInstance.listSlots<RunMeta>(id).then((s) => {
      if (!cancelled) setSlots(s.sort((a, b) => b.savedAt - a.savedAt));
    });
    return () => {
      cancelled = true;
    };
  }, [saveInstance, id, refreshKey]);
  return slots;
}

// ---------------------------------------------------------------------------
// 3. Reusable UI atoms
// ---------------------------------------------------------------------------

const PANEL_BG = panelBg;

function MenuButton(props: {
  label: string;
  width?: number;
  onClick: () => void;
}) {
  return (
    <Button
      width={props.width ?? 220}
      height={42}
      textStyle={textStyle("button")}
      onClick={props.onClick}
      {...nineSliceBtnReact}
    >
      {props.label}
    </Button>
  );
}

function SmallButton(props: {
  label: string;
  width?: number;
  onClick: () => void;
}) {
  return (
    <Button
      width={props.width ?? 80}
      height={28}
      textStyle={textStyle("buttonSmall")}
      onClick={props.onClick}
      {...nineSliceBtnReact}
    >
      {props.label}
    </Button>
  );
}

function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString();
}

// ---------------------------------------------------------------------------
// 4. MenuScene — root scene; hosts main menu UI.
// ---------------------------------------------------------------------------

function MainMenuPanel(props: {
  onStartNew: () => void;
  onContinue: (slot: SlotInfo<RunMeta>) => void;
  onDeleteSlot: (slot: SlotInfo<RunMeta>) => Promise<void>;
  onOpenSettings: () => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const slots = useSlots(save, GAME_ID, refreshKey);
  const latest = slots[0];

  return (
    <Panel
      anchor="center"
      direction="column"
      gap={10}
      padding={20}
      alignItems="center"
      width={400}
      bg={PANEL_BG}
    >
      <Text style={textStyle("title", { fontSize: 26 })}>Save Stores</Text>
      <Text style={textStyle("subtitle")}>An in-game persistence demo</Text>

      <Panel direction="column" gap={8} alignItems="center">
        <MenuButton
          label={latest ? `Continue (Ch. ${latest.metadata?.chapter ?? "?"})` : "Continue"}
          onClick={() => latest && props.onContinue(latest)}
        />
        <MenuButton label="New Game" onClick={props.onStartNew} />
        <MenuButton label="Settings" onClick={props.onOpenSettings} />
      </Panel>

      <Panel direction="column" gap={4} padding={6} alignItems="center">
        <Text style={textStyle("label")}>Save Slots</Text>
        {slots.length === 0 ? (
          <Text style={textStyle("caption")}>No saves yet</Text>
        ) : (
          slots.map((slot) => (
            <Panel
              key={slot.name}
              direction="column"
              gap={2}
              alignItems="center"
            >
              <Text style={textStyle("body", { fontSize: 12 })}>
                {`${slot.metadata?.label ?? slot.name} · Ch. ${slot.metadata?.chapter ?? "?"} · ${slot.metadata?.coins ?? 0}c`}
              </Text>
              <Panel direction="row" gap={6} alignItems="center">
                <Text style={textStyle("caption")}>{formatTime(slot.savedAt)}</Text>
                <SmallButton
                  label="Load"
                  width={56}
                  onClick={() => props.onContinue(slot)}
                />
                <SmallButton
                  label="Del"
                  width={48}
                  onClick={async () => {
                    await props.onDeleteSlot(slot);
                    setRefreshKey((k) => k + 1);
                  }}
                />
              </Panel>
            </Panel>
          ))
        )}
      </Panel>
    </Panel>
  );
}

class MenuScene extends Scene {
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

function GameplayHUD() {
  const run = useStore(game.progression);
  const deathCount = useStore(game.deaths);
  return (
    <Panel
      anchor="top-left"
      direction="row"
      gap={12}
      padding={8}
      bg={PANEL_BG}
    >
      <Text style={textStyle("body")}>{`Ch. ${run.chapter}`}</Text>
      <Text style={textStyle("body", { fill: 0xfacc15 })}>
        {`Coins: ${run.coins}`}
      </Text>
      <Text style={textStyle("body", { fill: 0xef4444 })}>
        {`Deaths: ${deathCount}`}
      </Text>
    </Panel>
  );
}

function GameplayActions() {
  return (
    <Panel
      anchor="bottom-center"
      direction="row"
      gap={8}
      padding={10}
      bg={PANEL_BG}
    >
      <SmallButton
        label="Collect"
        width={90}
        onClick={() =>
          game.progression.set({
            coins: game.progression.get().coins + 1,
          })
        }
      />
      <SmallButton
        label="Next Ch."
        width={90}
        onClick={() =>
          game.progression.set({
            chapter: game.progression.get().chapter + 1,
            coins: 0,
          })
        }
      />
      <SmallButton
        label="Die"
        width={70}
        onClick={() => game.deaths.increment()}
      />
    </Panel>
  );
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

const SLOT_NAMES = ["manual-1", "manual-2", "manual-3"] as const;
type SlotName = (typeof SLOT_NAMES)[number];

function PauseMenuPanel(props: {
  onResume: () => void;
  onSave: (slot: SlotName) => Promise<void>;
  onMainMenu: () => void;
  refreshKey: number;
}) {
  const slots = useSlots(save, GAME_ID, props.refreshKey);
  const slotByName = new Map(slots.map((s) => [s.name, s]));

  return (
    <Panel
      anchor="center"
      direction="column"
      gap={10}
      padding={20}
      alignItems="center"
      bg={PANEL_BG}
    >
      <Text style={textStyle("title", { fontSize: 22 })}>Paused</Text>

      <Panel direction="column" gap={6} alignItems="center">
        <Text style={textStyle("label")}>Save to slot</Text>
        {SLOT_NAMES.map((name) => {
          const existing = slotByName.get(name);
          const summary = existing
            ? `${existing.metadata?.label ?? name} · Ch. ${existing.metadata?.chapter ?? "?"} · ${existing.metadata?.coins ?? 0}c`
            : `${name} · empty`;
          return (
            <Panel
              key={name}
              direction="row"
              gap={6}
              alignItems="center"
            >
              <Text style={textStyle("body", { fontSize: 12 })}>{summary}</Text>
              <SmallButton
                label="Save"
                width={70}
                onClick={() => {
                  void props.onSave(name);
                }}
              />
            </Panel>
          );
        })}
      </Panel>

      <Panel direction="column" gap={6} alignItems="center">
        <MenuButton label="Resume" onClick={props.onResume} />
        <MenuButton label="Main Menu" onClick={props.onMainMenu} />
      </Panel>
    </Panel>
  );
}

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

function VolumeRow(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Panel direction="row" gap={10} alignItems="center">
      <Text style={textStyle("body", { fontSize: 13 })}>
        {`${props.label}`}
      </Text>
      <PixiProgressBar
        bg={S.sliderTrack}
        fill={S.sliderFillBlue}
        nineSliceSprite={nineSlice.track}
        value={Math.round(props.value * 100)}
        width={180}
        height={12}
      />
      <Text style={textStyle("body", { fontSize: 13 })}>
        {`${Math.round(props.value * 100)}%`}
      </Text>
      <SmallButton
        label="-"
        width={36}
        onClick={() => props.onChange(Math.max(0, props.value - 0.1))}
      />
      <SmallButton
        label="+"
        width={36}
        onClick={() => props.onChange(Math.min(1, props.value + 0.1))}
      />
    </Panel>
  );
}

function SettingsPanel(props: { onBack: () => void }) {
  const audio = useStore(settings.audio);
  const vsync = useStore(settings.vsync);
  return (
    <Panel
      anchor="center"
      direction="column"
      gap={12}
      padding={20}
      alignItems="center"
      bg={PANEL_BG}
    >
      <Text style={textStyle("title", { fontSize: 22 })}>Settings</Text>
      <Text style={textStyle("subtitle")}>Auto-saved on every change</Text>

      <VolumeRow
        label="Music"
        value={audio.music}
        onChange={(v) => settings.audio.set({ music: v })}
      />
      <VolumeRow
        label="SFX  "
        value={audio.sfx}
        onChange={(v) => settings.audio.set({ sfx: v })}
      />

      <Checkbox
        label="VSync"
        labelStyle={textStyle("body")}
        checked={vsync}
        onChange={(v) => settings.vsync.set(v)}
      />

      <MenuButton label="Back" onClick={props.onBack} />
    </Panel>
  );
}

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

// ---------------------------------------------------------------------------
// 8. Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Pre-engine: restore stored data so the menu reflects last-saved state.
  await Promise.all([
    save.restore(GAME_ID, game),
    save.restore(SETTINGS_ID, settings),
  ]);

  // Stream both compounds to disk (microtask-coalesced). Mutations to any
  // leaf trigger one debounced write per compound — not per leaf.
  save.autoPersist(GAME_ID, game);
  save.autoPersist(SETTINGS_ID, settings);

  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: 800,
      height: 600,
      virtualWidth: 800,
      virtualHeight: 600,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(800, 600),
    }),
  );
  engine.use(new UIPlugin());
  engine.use(new UIReactPlugin());
  engine.use(
    new InputPlugin({
      actions: { Escape: ["Escape"] },
    }),
  );
  engine.use(new SavePlugin({ save }));
  engine.use(new DebugPlugin());

  await loadFonts();
  await engine.start();
  await engine.scenes.push(new MenuScene());
}

main().catch(console.error);
