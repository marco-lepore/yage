import type { HudDebugApi } from "./types.js";
import type { TextPool } from "./TextPool.js";
import type { DebugRegistryImpl } from "./DebugRegistryImpl.js";

/** HudDebugApi backed by a TextPool. Contributor name is swapped per iteration. */
export class HudDebugApiImpl implements HudDebugApi {
  private _contributorName = "";

  constructor(
    private readonly textPool: TextPool,
    private readonly registry: DebugRegistryImpl,
    public readonly screenWidth: number,
    public readonly screenHeight: number,
  ) {}

  /** Set the current contributor name (called before each contributor's drawHud). */
  setContributor(name: string): void {
    this._contributorName = name;
  }

  addLine(text: string): void {
    this.textPool.addLine(text);
  }

  isFlagEnabled(flag: string): boolean {
    return this.registry.isFlagEnabled(this._contributorName, flag);
  }
}
