import {
  Panel,
  Text,
  Button,
  Checkbox,
  PixiProgressBar,
  useStore,
} from "@yagejs/ui-react";
import {
  textStyle,
  nineSliceBtnReact,
  panelBg,
  sprites as S,
  nineSlice,
} from "../shared/ui-theme.js";
import {
  game,
  settings,
  SLOT_NAMES,
  collectCoin,
  nextChapter,
  recordDeath,
  stepVolume,
} from "./stores.js";
import type { SaveSlots } from "./slots.js";
import type { MainMenu, PauseMenu, SettingsMenu } from "./scenes.js";

// ---------------------------------------------------------------------------
// 4. React panels
//
// The panels only display state and forward clicks: to the scene's menu
// component, to SaveSlots, or to the rules in stores.ts.
// ---------------------------------------------------------------------------

function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString();
}

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

export function MainMenuPanel(props: { menu: MainMenu; slots: SaveSlots }) {
  const { menu } = props;
  const slots = useStore(props.slots.list);
  const latest = slots[0];

  return (
    <Panel
      direction="column"
      gap={10}
      padding={20}
      alignItems="center"
      width={400}
      bg={panelBg}
    >
      <Text style={textStyle("title", { fontSize: 26 })}>Save Stores</Text>
      <Text style={textStyle("subtitle")}>An in-game persistence demo</Text>

      <Panel direction="column" gap={8} alignItems="center">
        <MenuButton
          label={
            latest
              ? `Continue (Ch. ${latest.metadata?.chapter ?? "?"})`
              : "Continue"
          }
          onClick={() => {
            if (latest) void menu.continueFrom(latest);
          }}
        />
        <MenuButton label="New Game" onClick={() => menu.newGame()} />
        <MenuButton label="Settings" onClick={() => menu.openSettings()} />
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
                <Text style={textStyle("caption")}>
                  {formatTime(slot.savedAt)}
                </Text>
                <SmallButton
                  label="Load"
                  width={56}
                  onClick={() => {
                    void menu.continueFrom(slot);
                  }}
                />
                <SmallButton
                  label="Del"
                  width={48}
                  onClick={() => {
                    void props.slots.remove(slot);
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

export function GameplayHUD() {
  const run = useStore(game.progression);
  const deathCount = useStore(game.deaths);
  return (
    <Panel direction="row" gap={12} padding={8} bg={panelBg}>
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

export function GameplayActions() {
  return (
    <Panel direction="row" gap={8} padding={10} bg={panelBg}>
      <SmallButton label="Collect" width={90} onClick={collectCoin} />
      <SmallButton label="Next Ch." width={90} onClick={nextChapter} />
      <SmallButton label="Die" width={70} onClick={recordDeath} />
    </Panel>
  );
}

export function PauseMenuPanel(props: { menu: PauseMenu; slots: SaveSlots }) {
  const { menu } = props;
  const slots = useStore(props.slots.list);
  const slotByName = new Map(slots.map((s) => [s.name, s]));

  return (
    <Panel
      direction="column"
      gap={10}
      padding={20}
      alignItems="center"
      bg={panelBg}
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
            <Panel key={name} direction="row" gap={6} alignItems="center">
              <Text style={textStyle("body", { fontSize: 12 })}>{summary}</Text>
              <SmallButton
                label="Save"
                width={70}
                onClick={() => {
                  void props.slots.saveTo(name);
                }}
              />
            </Panel>
          );
        })}
      </Panel>

      <Panel direction="column" gap={6} alignItems="center">
        <MenuButton label="Resume" onClick={() => menu.resume()} />
        <MenuButton
          label="Main Menu"
          onClick={() => {
            void menu.quitToMenu();
          }}
        />
      </Panel>
    </Panel>
  );
}

function VolumeRow(props: { label: string; channel: "music" | "sfx" }) {
  const { channel } = props;
  const value = useStore(settings.audio, (audio) => audio.get()[channel]);
  return (
    <Panel direction="row" gap={10} alignItems="center">
      <Text style={textStyle("body", { fontSize: 13 })}>
        {`${props.label}`}
      </Text>
      <PixiProgressBar
        bg={S.sliderTrack}
        fill={S.sliderFillBlue}
        nineSliceSprite={nineSlice.track}
        value={Math.round(value * 100)}
        width={180}
        height={12}
      />
      <Text style={textStyle("body", { fontSize: 13 })}>
        {`${Math.round(value * 100)}%`}
      </Text>
      <SmallButton
        label="-"
        width={36}
        onClick={() => stepVolume(channel, -0.1)}
      />
      <SmallButton
        label="+"
        width={36}
        onClick={() => stepVolume(channel, 0.1)}
      />
    </Panel>
  );
}

export function SettingsPanel(props: { menu: SettingsMenu }) {
  const vsync = useStore(settings.vsync);
  return (
    <Panel
      direction="column"
      gap={12}
      padding={20}
      alignItems="center"
      bg={panelBg}
    >
      <Text style={textStyle("title", { fontSize: 22 })}>Settings</Text>
      <Text style={textStyle("subtitle")}>Auto-saved on every change</Text>

      <VolumeRow label="Music" channel="music" />
      <VolumeRow label="SFX  " channel="sfx" />

      <Checkbox
        label="VSync"
        labelStyle={textStyle("body")}
        checked={vsync}
        onChange={(v) => settings.vsync.set(v)}
      />

      <MenuButton label="Back" onClick={() => props.menu.back()} />
    </Panel>
  );
}
