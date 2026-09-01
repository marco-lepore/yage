import { Engine, createStore } from "@yagejs/core";
import {
  SavePlugin,
  SaveServiceKey,
  createSave,
  localStorageAdapter,
} from "@yagejs/save";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();
setupContainer(640, 360);

const run = createStore((state) => ({
  score: state.counter({ default: 0 }),
  player: state.record<{ x: number; y: number }>({
    default: () => ({ x: 100, y: 200 }),
  }),
  flags: state.set<string>(),
}));

const save = createSave({
  adapter: localStorageAdapter({ namespace: "yage-e2e-save" }),
});
const engine = new Engine({ debug: true });
engine.use(new SavePlugin({ save }));
await engine.start();

const service = engine.context.resolve(SaveServiceKey);

(window as any).__saveFixture__ = {
  state: () => ({
    score: run.score.value(),
    player: run.player.get(),
    flags: [...run.flags.values()],
  }),
  setState: (score: number, x: number, y: number, flag: string) => {
    run.score.set(score);
    run.player.set({ x, y });
    run.flags.add(flag);
  },
  saveSlot: (slot: string) => service.saveSlot("run", slot, run),
  loadSlot: (slot: string) => service.loadSlot("run", slot, run),
  listSlots: () => service.listSlots("run"),
  deleteSlot: (slot: string) => service.deleteSlot("run", slot),
};
