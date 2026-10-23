import type { ErrorBoundary } from "@yagejs/core";
/* Worker readiness uses wall time because no scene clock runs during plugin installation. */
/* eslint-disable no-restricted-globals */
import { resolveSynthInstrument } from "./core/instruments.js";
import type { SynthInstrumentBank } from "./core/instruments.js";
import type { SynthSample } from "./core/instruments.js";
import type { SynthSound } from "./core/types.js";
import { renderSynthSample } from "./core/sample.js";
import { isSynthInstrument } from "./core/render.js";
import type { SynthWorkerResponse } from "./worker.js";

export interface SynthRenderDiagnostics {
  state: "idle" | "rendering" | "ready" | "failed" | "disposed";
  mode: "main" | "worker";
  completed: number;
  total: number;
  fallbackReason: string | null;
  failure: string | null;
}
/** @internal Worker ownership and readiness for one plugin install. */
export class RenderBank {
  readonly diagnostics: SynthRenderDiagnostics = {
    state: "idle",
    mode: "main",
    completed: 0,
    total: 0,
    fallbackReason: null,
    failure: null,
  };
  private cancel: (() => void) | undefined;
  constructor(
    private readonly worker: Worker | undefined,
    private readonly timeout: number,
    private readonly instruments: SynthInstrumentBank = {},
  ) {}
  async render(
    sounds: readonly SynthSound[],
    sampleRate: number,
    boundary?: ErrorBoundary,
  ): Promise<SynthSample[]> {
    for (const sound of sounds)
      if (isSynthInstrument(sound))
        resolveSynthInstrument(sound, this.instruments);
    this.diagnostics.state = "rendering";
    this.diagnostics.total = sounds.length;
    if (this.worker && sounds.length) {
      this.diagnostics.mode = "worker";
      const result = await this.inWorker(sounds, sampleRate);
      if (result) return result;
    }
    this.diagnostics.mode = "main";
    const result: SynthSample[] = [];
    for (const sound of sounds) {
      let sample: SynthSample | undefined;
      const render = (): void => {
        sample = renderSynthSample(sound, sampleRate, this.instruments);
      };
      if (boundary && isSynthInstrument(sound))
        boundary.wrapCallback(render, {
          kind: "Synth instrument renderer",
          event: sound.instrument,
        });
      else render();
      result.push(sample!);
      this.diagnostics.completed = result.length;
    }
    return result;
  }
  private inWorker(
    sounds: readonly SynthSound[],
    sampleRate: number,
  ): Promise<SynthSample[] | undefined> {
    const worker = this.worker!;
    return new Promise((resolve, reject) => {
      const result = new Map<number, SynthSample>();
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = (): void => {
        clearTimeout(timer);
        worker.removeEventListener("message", message);
        worker.removeEventListener("error", failure);
        worker.removeEventListener("messageerror", failure);
        worker.terminate();
        this.cancel = undefined;
      };
      const fallback = (reason: string): void => {
        cleanup();
        this.diagnostics.fallbackReason = reason;
        this.diagnostics.completed = 0;
        resolve(undefined);
      };
      const failure = (event: Event): void =>
        fallback(
          "message" in event ? String(event.message) : `Worker ${event.type}`,
        );
      const message = (event: MessageEvent<SynthWorkerResponse>): void => {
        const data = event.data;
        if (
          !Number.isInteger(data.id) ||
          data.id < 0 ||
          data.id >= sounds.length ||
          result.has(data.id)
        ) {
          fallback("Worker sent an invalid or duplicate result id.");
          return;
        }
        if ("error" in data) {
          cleanup();
          reject(new Error(`SynthPlugin: render ${data.id}: ${data.error}`));
          return;
        }
        result.set(data.id, data.sample);
        this.diagnostics.completed = result.size;
        if (result.size === sounds.length) {
          cleanup();
          resolve(sounds.map((_, id) => result.get(id)!));
        } else {
          clearTimeout(timer);
          timer = setTimeout(
            () => fallback("Worker render timed out."),
            this.timeout,
          );
        }
      };
      timer = setTimeout(
        () => fallback("Worker render timed out."),
        this.timeout,
      );
      this.cancel = () => {
        cleanup();
        reject(new Error("SynthPlugin: disposed during rendering."));
      };
      worker.addEventListener("message", message);
      worker.addEventListener("error", failure);
      worker.addEventListener("messageerror", failure);
      try {
        sounds.forEach((sound, id) =>
          worker.postMessage({ id, sound, sampleRate }),
        );
      } catch (error) {
        fallback(error instanceof Error ? error.message : String(error));
      }
    });
  }
  dispose(): void {
    this.cancel?.();
    this.worker?.terminate();
    this.diagnostics.state = "disposed";
  }
}
