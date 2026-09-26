import { createStore } from "@yagejs/core";

// ---------------------------------------------------------------------------
// 1. Save roots
//
// `game` collects every run-state leaf into one save document. `settings` is
// its own compound because it persists separately (across runs). Both live at
// module level because @yagejs/save persists them: main.tsx restores them
// before the engine starts.
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

/** Metadata stored with each run slot, shown in the slot lists. */
export interface RunMeta {
  chapter: number;
  coins: number;
  deaths: number;
  label?: string;
}

export const SLOT_NAMES = ["manual-1", "manual-2", "manual-3"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

// ---------------------------------------------------------------------------
// 2. Rules over the stores
//
// The buttons call these functions; the stores notify `useStore` and the
// auto-persist on every change.
// ---------------------------------------------------------------------------

/** Start a fresh run: chapter 1, no coins, no deaths. */
export function newRun(): void {
  game.reset();
}

export function collectCoin(): void {
  game.progression.set({ coins: game.progression.get().coins + 1 });
}

/** Move on to the next chapter, which starts with no coins. */
export function nextChapter(): void {
  game.progression.set({
    chapter: game.progression.get().chapter + 1,
    coins: 0,
  });
}

export function recordDeath(): void {
  game.deaths.increment();
}

/** Change one volume by `delta`, kept between 0 and 1. */
export function stepVolume(channel: "music" | "sfx", delta: number): void {
  const audio = { ...settings.audio.get() };
  audio[channel] = Math.min(1, Math.max(0, audio[channel] + delta));
  settings.audio.set(audio);
}

/** The metadata a slot saved now would carry. */
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
