/**
 * Save Stores example
 *
 * Demonstrates the primary persistence path of @yagejs/save — typed reactive
 * stores + a Save instance for slots, metadata, and auto-persist:
 *
 *   - `defineStore<T>` for object data (settings, progression)
 *   - `defineCounter` for a death counter
 *   - `save.persist` / `save.restore` for unslotted documents (settings)
 *   - `save.autoPersist` to write on every change (microtask-coalesced)
 *   - `save.saveSlot` / `loadSlot` / `listSlots` / `deleteSlot` with typed metadata
 *   - "Continue" picks the most recent slot (manual or auto)
 *   - "New game" resets all stores and writes a fresh auto-save
 *
 * For the snapshot path (full-scene serialization via @serializable) see
 * `save-load.ts`.
 */

import {
  Engine,
  Scene,
  Component,
  Transform,
  Vec2,
  defineStore,
  defineCounter,
  type PersistentStore,
} from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  type GraphicsContext,
} from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import {
  createSave,
  SavePlugin,
  localStorageAdapter,
} from "@yagejs/save";
import { injectStyles, setupGameContainer } from "./shared.js";

injectStyles();

// ---------------------------------------------------------------------------
// 1. Stores
//
//    Stores are typed singletons defined at module scope. They know nothing
//    about save IO — they only expose `serialize` / `hydrate` for the save
//    layer to call.
// ---------------------------------------------------------------------------

interface SettingsData {
  music: number;
  sfx: number;
  vsync: boolean;
}

const settings = defineStore<SettingsData>("save-stores.settings", {
  version: 1,
  defaults: () => ({ music: 0.8, sfx: 1.0, vsync: true }),
});

interface ProgressionData {
  chapter: number;
  coins: number;
}

const progression = defineStore<ProgressionData>("save-stores.progression", {
  version: 1,
  defaults: () => ({ chapter: 1, coins: 0 }),
});

const deaths = defineCounter("save-stores.deaths");

interface RunMeta {
  chapter: number;
  coins: number;
  deaths: number;
  label?: string;
}

// ---------------------------------------------------------------------------
// 2. Save instance + adapter
//
//    Construct once at module scope. The plugin only registers it under
//    SaveServiceKey for in-game DI access — boot-time work uses `save`
//    directly.
// ---------------------------------------------------------------------------

const save = createSave({
  adapter: localStorageAdapter({ namespace: "yage-save-stores-example" }),
});

// ---------------------------------------------------------------------------
// 3. Background scene — coin sprite that grows with collected coins
// ---------------------------------------------------------------------------

class CoinDisplay extends Component {
  static draw(g: GraphicsContext, coins: number): void {
    g.clear();
    const scale = Math.min(1 + coins * 0.05, 3);
    const r = 30 * scale;
    g.circle(0, 0, r).fill({ color: 0xfacc15 });
    g.circle(0, 0, r).stroke({ color: 0xeab308, width: 3 });
  }

  private graphics = this.sibling(GraphicsComponent);
  private unsub: (() => void) | null = null;

  onAdd(): void {
    const apply = (): void => {
      this.graphics.draw((g) => CoinDisplay.draw(g, progression.get().coins));
    };
    apply();
    this.unsub = progression.subscribe(apply);
  }

  onRemove(): void {
    this.unsub?.();
    this.unsub = null;
  }
}

class StoresScene extends Scene {
  readonly name = "save-stores";

  onEnter(): void {
    const coin = this.spawn("coin");
    coin.add(new Transform({ position: new Vec2(400, 300) }));
    coin.add(new GraphicsComponent());
    coin.add(new CoinDisplay());
  }
}

// ---------------------------------------------------------------------------
// 4. UI bindings
//
//    DOM controls subscribe to stores and call `set` / `update` on user input.
// ---------------------------------------------------------------------------

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function bindSettings(): void {
  const music = $<HTMLInputElement>("music");
  const sfx = $<HTMLInputElement>("sfx");
  const vsync = $<HTMLInputElement>("vsync");
  const musicVal = $<HTMLSpanElement>("music-value");
  const sfxVal = $<HTMLSpanElement>("sfx-value");
  const status = $<HTMLParagraphElement>("settings-status");

  const apply = (): void => {
    const s = settings.get();
    music.valueAsNumber = Math.round(s.music * 100);
    sfx.valueAsNumber = Math.round(s.sfx * 100);
    vsync.checked = s.vsync;
    musicVal.textContent = `${Math.round(s.music * 100)}%`;
    sfxVal.textContent = `${Math.round(s.sfx * 100)}%`;
  };
  apply();
  settings.subscribe(apply);

  music.addEventListener("input", () => {
    settings.set({ music: music.valueAsNumber / 100 });
  });
  sfx.addEventListener("input", () => {
    settings.set({ sfx: sfx.valueAsNumber / 100 });
  });
  vsync.addEventListener("change", () => {
    settings.set({ vsync: vsync.checked });
  });

  // autoPersist coalesces synchronous changes and writes on the next
  // microtask, so by the time a `subscribe` listener returns the write is
  // either in flight or already committed for tiny localStorage payloads.
  // Show a timestamp of the last-saved state so the user can see writes are
  // happening without claiming an artificial "Saving…" pause.
  settings.subscribe(() => {
    status.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
    status.style.color = "#22c55e";
  });
}

function bindProgression(): void {
  const chapterEl = $<HTMLElement>("chapter");
  const coinsEl = $<HTMLElement>("coins");
  const deathsEl = $<HTMLElement>("deaths");

  const apply = (): void => {
    const p = progression.get();
    chapterEl.textContent = String(p.chapter);
    coinsEl.textContent = String(p.coins);
    deathsEl.textContent = String(deaths.value());
  };
  apply();
  progression.subscribe(apply);
  deaths.subscribe(apply);

  $<HTMLButtonElement>("collect").addEventListener("click", () => {
    progression.set({ coins: progression.get().coins + 1 });
  });
  $<HTMLButtonElement>("advance").addEventListener("click", () => {
    progression.set({ chapter: progression.get().chapter + 1, coins: 0 });
  });
  $<HTMLButtonElement>("die").addEventListener("click", () => {
    deaths.increment();
  });
  $<HTMLButtonElement>("reset").addEventListener("click", async () => {
    progression.reset();
    deaths.reset();
    await save.saveSlot<RunMeta>(progression, "auto", {
      metadata: snapshotMeta(),
    });
    await refreshSlotList();
  });
}

function snapshotMeta(): RunMeta {
  const p = progression.get();
  return {
    chapter: p.chapter,
    coins: p.coins,
    deaths: deaths.value(),
  };
}

async function bindSaveSlots(): Promise<void> {
  const wire = (slot: string, btnId: string): void => {
    $<HTMLButtonElement>(btnId).addEventListener("click", async () => {
      await save.saveSlot<RunMeta>(progression, slot, {
        metadata: { ...snapshotMeta(), label: slot },
      });
      await refreshSlotList();
    });
  };
  wire("manual-1", "save-1");
  wire("manual-2", "save-2");
  wire("manual-3", "save-3");

  $<HTMLButtonElement>("continue").addEventListener("click", async () => {
    await loadLatest();
  });

  await refreshSlotList();
}

function formatTime(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString();
}

async function refreshSlotList(): Promise<void> {
  const list = $<HTMLDivElement>("slot-list");
  const slots = await save.listSlots<RunMeta>(progression);
  if (slots.length === 0) {
    list.textContent = "No saves yet.";
    list.style.color = "#666";
    return;
  }
  list.style.color = "";
  list.replaceChildren();
  const sorted = [...slots].sort((a, b) => b.savedAt - a.savedAt);
  for (const slot of sorted) {
    const row = document.createElement("div");
    row.className = "slot-row";
    const meta = document.createElement("span");
    meta.className = "meta";
    const m = slot.metadata;
    // Slot metadata round-trips through localStorage (or any user-replaceable
    // backing store), so we treat every field as untrusted text. Build the
    // DOM nodes explicitly instead of stringifying into innerHTML so a
    // tampered save can't inject markup or scripts here.
    const label = m?.label ?? slot.name;
    const labelEl = document.createElement("b");
    labelEl.textContent = label;
    meta.appendChild(labelEl);
    meta.appendChild(
      document.createTextNode(
        ` · ${formatTime(slot.savedAt)} · ` +
          `chapter ${m?.chapter ?? "?"} · ${m?.coins ?? 0} coins · ` +
          `${m?.deaths ?? 0} deaths`,
      ),
    );
    const loadBtn = document.createElement("button");
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", async () => {
      await save.loadSlot(progression, slot.name);
      // Deaths is a separate store; keep it in sync via a parallel save in a
      // real game — this example saves only progression to keep the demo
      // focused on a single slot store.
    });
    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      await save.deleteSlot(progression, slot.name);
      await refreshSlotList();
    });
    row.appendChild(meta);
    row.appendChild(loadBtn);
    row.appendChild(delBtn);
    list.appendChild(row);
  }
}

async function loadLatest(): Promise<void> {
  const slots = await save.listSlots<RunMeta>(progression);
  if (slots.length === 0) return;
  const latest = [...slots].sort((a, b) => b.savedAt - a.savedAt)[0];
  if (!latest) return;
  await save.loadSlot(progression, latest.name);
}

function startAutoSave(): () => void {
  // Periodic auto-save to slot "auto" — every 30 s while the page is open.
  const interval = setInterval(async () => {
    await save.saveSlot<RunMeta>(progression, "auto", {
      metadata: { ...snapshotMeta(), label: "auto" },
    });
    await refreshSlotList();
    const status = $<HTMLSpanElement>("autosave-status");
    status.textContent = `Auto-saved at ${formatTime(Date.now())}`;
  }, 30_000);
  return () => clearInterval(interval);
}

// Help typecheck: PersistentStore<T>.subscribe is callable with no args, so
// this re-export is just to silence "unused import" without using `void`.
const _typeProbe: PersistentStore<SettingsData> = settings;
void _typeProbe;

// ---------------------------------------------------------------------------
// 5. Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Restore settings + progression + deaths from disk before booting the engine
  // — boot-time UI reflects the last-saved state on page load.
  await save.restoreAll([settings, progression, deaths]);

  // Stream settings changes back to disk, microtask-coalesced.
  save.autoPersist(settings);
  // Progression auto-persists too, so refresh-after-collect doesn't lose state
  // even without an explicit save.
  save.autoPersist(progression);
  save.autoPersist(deaths);

  bindSettings();
  bindProgression();
  await bindSaveSlots();
  startAutoSave();

  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: 800,
      height: 600,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(800, 600),
    }),
  );
  engine.use(new SavePlugin({ save }));
  engine.use(new DebugPlugin());

  await engine.start();
  await engine.scenes.push(new StoresScene());
}

main().catch(console.error);
