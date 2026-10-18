import { Entity, Transform, Vec2 } from "@yagejs/core";
import type { AssetHandle } from "@yagejs/core";
import { AudioManagerKey, sound } from "@yagejs/audio";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

const Coin = sound("assets/coin.wav");

/** The assets this case needs loaded before it mounts. */
export const assets: readonly AssetHandle<unknown>[] = [Coin];

/** What the audio case reports. */
export interface AudioReading extends CaseReading {
  unlocked: boolean;
  played: boolean;
  refusal: string | null;
}

/**
 * Plays one sound at boot and reports whether the host let it through. A host
 * that holds audio until a gesture reads `unlocked` false, which is an
 * observation about the host rather than a failure.
 */
export class AudioProbe extends CaseProbe {
  private readonly audio = this.service(AudioManagerKey);
  private played = false;
  private refusal: string | null = null;
  private done = false;

  onAdd(): void {
    try {
      this.audio.play(Coin, { channel: "sfx" });
      this.played = true;
    } catch (error) {
      this.refusal = (error as Error).message;
    }
    this.done = true;
  }

  get settled(): boolean {
    return this.done;
  }

  reading(): AudioReading {
    return {
      unlocked: this.audio.isUnlocked(),
      played: this.played,
      refusal: this.refusal,
    };
  }
}

/** One sound effect, played once at boot. */
export class AudioCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(600, 40) }));
    this.add(new AudioProbe());
  }
}
