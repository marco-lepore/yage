import { useState } from "react";
import {
  Panel,
  Text,
  Button,
  Checkbox,
  PixiProgressBar,
  useStore,
} from "@yagejs/ui-react";
import type { SlotInfo } from "@yagejs/save";
import {
  textStyle,
  nineSliceBtnReact,
  sprites as S,
  nineSlice,
} from "../shared/ui-theme.js";
import {
  game,
  settings,
  save,
  GAME_ID,
  PANEL_BG,
  SLOT_NAMES,
  useSlots,
  formatTime,
  type RunMeta,
  type SlotName,
} from "./stores.js";

// ---------------------------------------------------------------------------
// 3. Reusable UI atoms
// ---------------------------------------------------------------------------

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

export function MainMenuPanel(props: {
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

export function GameplayHUD() {
  const run = useStore(game.progression);
  const deathCount = useStore(game.deaths);
  return (
    <Panel
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

export function GameplayActions() {
  return (
    <Panel
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

export function PauseMenuPanel(props: {
  onResume: () => void;
  onSave: (slot: SlotName) => Promise<void>;
  onMainMenu: () => void;
  refreshKey: number;
}) {
  const slots = useSlots(save, GAME_ID, props.refreshKey);
  const slotByName = new Map(slots.map((s) => [s.name, s]));

  return (
    <Panel
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

export function SettingsPanel(props: { onBack: () => void }) {
  const audio = useStore(settings.audio);
  const vsync = useStore(settings.vsync);
  return (
    <Panel
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
