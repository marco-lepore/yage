import { useEffect, useState } from "react";
import { createStore } from "@yagejs/core";
import {
  createSave,
  localStorageAdapter,
  type SlotInfo,
  type Save,
} from "@yagejs/save";
import { panelBg } from "../shared/ui-theme.js";

// ---------------------------------------------------------------------------
// 1. Compound stores
//
// `game` collects every run-state leaf into one save document. `settings` is
// its own compound because it persists separately (across runs).
// ---------------------------------------------------------------------------

export const GAME_ID = "save-stores.run";
export const SETTINGS_ID = "save-stores.settings";

export const game = createStore((s) => ({
  progression: s.record<{ chapter: number; coins: number }>({
    default: () => ({ chapter: 1, coins: 0 }),
  }),
  deaths: s.counter({ default: 0 }),
}));

export const settings = createStore((s) => ({
  audio: s.record<{ music: number; sfx: number }>({
    default: () => ({ music: 0.8, sfx: 1.0 }),
  }),
  vsync: s.value<boolean>({ default: true }),
}));

export interface RunMeta {
  chapter: number;
  coins: number;
  deaths: number;
  label?: string;
}

// ---------------------------------------------------------------------------
// 2. Save instance — created in user code, registered via SavePlugin.
// ---------------------------------------------------------------------------

export const save = createSave({
  adapter: localStorageAdapter({ namespace: "yage-save-stores-example" }),
});

export function snapshotRunMeta(label?: string): RunMeta {
  const p = game.progression.get();
  const meta: RunMeta = {
    chapter: p.chapter,
    coins: p.coins,
    deaths: game.deaths.value(),
  };
  if (label !== undefined) meta.label = label;
  return meta;
}

export function newRun(): void {
  game.reset();
}

// `useSlots` re-reads `save.listSlots(id)` whenever `refreshKey` bumps
// (called explicitly from save/delete handlers).
export function useSlots(
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

export const PANEL_BG = panelBg;

export function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString();
}

export const SLOT_NAMES = ["manual-1", "manual-2", "manual-3"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];
