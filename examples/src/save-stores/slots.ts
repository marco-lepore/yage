import { Component, createValue } from "@yagejs/core";
import { SaveServiceKey, type SlotInfo } from "@yagejs/save";
import {
  game,
  GAME_ID,
  snapshotRunMeta,
  type RunMeta,
  type SlotName,
} from "./stores.js";

// ---------------------------------------------------------------------------
// 3. Save slots, through the engine's DI
// ---------------------------------------------------------------------------

/**
 * The run's save slots. Every call goes to the Save instance SavePlugin
 * registered, resolved through `SaveServiceKey`.
 *
 * `list` holds the slots newest first, for the React UI to read with
 * `useStore(slots.list)`. It is a copy of the slot manifest for display and is
 * not saved itself.
 */
export class SaveSlots extends Component {
  private readonly save = this.service(SaveServiceKey);
  readonly list = createValue<readonly SlotInfo<RunMeta>[]>({
    default: () => [],
  });

  onAdd(): void {
    void this.refresh();
  }

  /** Re-read the slot manifest into `list`. */
  async refresh(): Promise<void> {
    const slots = await this.save.listSlots<RunMeta>(GAME_ID);
    this.list.set(slots.sort((a, b) => b.savedAt - a.savedAt));
  }

  /** Save the current run into slot `name`, replacing what was there. */
  async saveTo(name: SlotName): Promise<void> {
    await this.save.saveSlot<unknown, RunMeta>(GAME_ID, name, game, {
      metadata: snapshotRunMeta(name),
    });
    await this.refresh();
  }

  /** Replace the current run with the one stored in `slot`. */
  async load(slot: SlotInfo<RunMeta>): Promise<void> {
    await this.save.loadSlot(GAME_ID, slot.name, game);
  }

  async remove(slot: SlotInfo<RunMeta>): Promise<void> {
    await this.save.deleteSlot(GAME_ID, slot.name);
    await this.refresh();
  }
}
