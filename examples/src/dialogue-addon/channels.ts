import { Transform, Vec2, type Entity, type Scene } from "@yagejs/core";
import { sound, type AudioManager } from "@yagejs/audio";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import {
  createVoiceChannel,
  type DialogueExtraChannel,
  type Mountable,
  type PresentedLine,
} from "@yagejs-addons/dialogue";
import { HUD_LAYER } from "./constants.js";

// ── extra channels: a built-in voice-over + a custom transcript ────────────────
//
// Channels a host registers on the conversation, alongside the built-in
// presenters (text / choices / avatar / chrome), through the controller's
// `channels` option (see `DialogueHostEntity`). The addon owns no audio and no
// transcript UI: both are the game's, added without changing the addon.

/** Sage's voice clips — real synthesized speech (macOS `say`, the Daniel voice),
 *  preloaded by the scene. The map turns each opaque `voice` id (authored in the
 *  YAML) into its clip; a host maps voice ids to assets exactly like this. */
export const VOICE: Record<string, ReturnType<typeof sound>> = {
  vo_sage_ramble: sound("/assets/voice/sage_ramble.mp3"),
  vo_sage_controls: sound("/assets/voice/sage_controls.mp3"),
  vo_sage_gate: sound("/assets/voice/sage_gate.mp3"),
  vo_sage_bye: sound("/assets/voice/sage_bye.mp3"),
};

/**
 * The built-in voice-over channel, playing each line's `voice` clip on the
 * "voice" audio channel. It holds auto-advance until the clip ends; `onEnd`
 * releases it the moment the clip finishes. With `onSkip: "ring"`, completing
 * the typewriter doesn't cut the voice: the clip plays on, and stops when the
 * next line appears or the conversation ends. Pausing the conversation (P)
 * pauses the clip.
 */
export function createSageVoice(audio: AudioManager): DialogueExtraChannel {
  return createVoiceChannel({
    onSkip: "ring",
    play: (id, onEnded) => {
      const clip = VOICE[id];
      if (!clip) {
        onEnded(); // an unknown id doesn't hold the line
        return { stop() {}, pause() {}, resume() {} };
      }
      const handle = audio.play(clip, { channel: "voice", onEnd: onEnded });
      return {
        stop: () => handle.stop(),
        pause: () => (handle.paused = true),
        resume: () => (handle.paused = false),
      };
    },
  });
}

/**
 * A tiny asset-free WebAudio synth for the **reveal-events** demo: a soft
 * per-grapheme typewriter `tick()` (wired to the controller's `onRevealTick`) and
 * a named `cue(name)` played at an inline `[sfx=name/]` marker (wired to
 * `DialogueRevealMarkerEvent`). A real game would play `@yagejs/audio` clips like
 * Sage's voice above; synth keeps the showcase asset-free. The `AudioContext` is
 * created lazily and `resume()`d — by the time you reach an NPC, a keypress has
 * already satisfied the browser's autoplay gesture requirement.
 */
export class BlipSynth {
  private ctx: AudioContext | undefined;
  private lastTick = 0;

  private ac(): AudioContext | undefined {
    if (this.ctx === undefined && typeof AudioContext !== "undefined") {
      this.ctx = new AudioContext();
    }
    void this.ctx?.resume();
    return this.ctx;
  }

  private blip(
    freq: number,
    ms: number,
    gain: number,
    type: OscillatorType,
  ): void {
    const ctx = this.ac();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000);
  }

  /** Per-grapheme typewriter click — rate-limited so a fast reveal stays subtle. */
  tick(): void {
    const ctx = this.ac();
    if (!ctx || ctx.currentTime - this.lastTick < 0.028) return;
    this.lastTick = ctx.currentTime;
    this.blip(620, 13, 0.035, "square");
  }

  /** A named positional cue (`[sfx=name/]`) — a distinct tone per name. */
  cue(name: string): void {
    const tones: Record<string, [number, number, number, OscillatorType]> = {
      chime: [1320, 240, 0.16, "sine"],
      page: [360, 80, 0.12, "triangle"],
    };
    const [f, ms, gain, type] = tones[name] ?? [880, 100, 0.12, "sine"];
    this.blip(f, ms, gain, type);
  }

  /** Release the audio context (a browser allows only a few at a time). */
  close(): void {
    void this.ctx?.close();
    this.ctx = undefined;
  }
}

/**
 * A CUSTOM extra channel — the "another channel" a game adds with zero addon
 * change. It implements ONLY `present` (a pure observer: it never gates
 * auto-advance and hands the session nothing back), logging each line the moment
 * it APPEARS (not waiting for the typewriter) to a small semi-opaque HUD panel. It
 * also implements {@link Mountable}, so the controller mounts it on the scene in
 * `onAdd` and disposes it in `onDestroy`, exactly like a presenter.
 */
export class TranscriptChannel implements DialogueExtraChannel, Mountable {
  private static readonly MAX = 3;
  private static readonly W = 286; // panel width
  private static readonly PAD = 8;
  private static readonly ROW = 16; // line height
  private readonly lines: string[] = [];
  private panel: Entity | undefined;
  private text: TextComponent | undefined;

  mount(scene: Scene): void {
    const { W, PAD, ROW, MAX } = TranscriptChannel;
    const h = PAD * 2 + ROW * MAX;
    // Top-left, under the gold/items line: clear of the bottom box AND the speech
    // bubbles (which float over the centre/right NPCs). The backing and the text
    // are children of the panel, so `dispose` destroys all three at once.
    this.panel = scene.spawn("transcript");
    this.panel.add(new Transform({ position: new Vec2(12, 52) }));
    // A semi-opaque backing keeps the log legible over the playfield.
    const backing = this.panel.spawnChild("backing");
    backing.add(new Transform());
    backing.add(
      new GraphicsComponent({ layer: HUD_LAYER }).draw((g) => {
        g.roundRect(0, 0, W, h, 6)
          .fill({ color: 0x0a0c16, alpha: 0.6 })
          .stroke({ color: 0x2a3146, width: 1, alpha: 0.8 });
      }),
    );
    // Spawned after the backing, so it renders above it in the layer.
    const text = this.panel.spawnChild("text");
    text.add(new Transform({ position: new Vec2(PAD, PAD) }));
    this.text = text.add(
      new TextComponent({
        text: "",
        style: {
          fontSize: 11,
          fill: 0xaab2c6,
          fontFamily: "sans-serif",
          lineHeight: ROW,
        },
        layer: HUD_LAYER,
        anchor: { x: 0, y: 0 },
      }),
    );
  }

  dispose(): void {
    this.panel?.destroy();
    this.panel = undefined;
    this.text = undefined;
  }

  /** Fires when a say line is PRESENTED — logged at once, not on reveal. */
  present(line: PresentedLine): void {
    const body = line.text.runs.map((r) => r.text).join("");
    const who = line.speaker?.name ? `${line.speaker.name}: ` : "";
    this.lines.push(this.clip(`${who}${body}`, 42));
    if (this.lines.length > TranscriptChannel.MAX) this.lines.shift();
    this.text?.setText(this.lines.join("\n"));
  }

  /** Clip a row to a single line. */
  private clip(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
  }
}
