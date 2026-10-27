import type { SynthInstrumentBank } from "./core/instruments.js";
import { renderSynthSample } from "./core/sample.js";
import type { SynthSound } from "./core/types.js";
import type { SynthSample } from "./core/instruments.js";
export interface SynthWorkerRequest {
  readonly id: number;
  readonly sound: SynthSound;
  readonly sampleRate: number;
}
export type SynthWorkerResponse =
  | { readonly id: number; readonly sample: SynthSample }
  | { readonly id: number; readonly error: string };
/** Call in a module worker entry. Pure rendering uses the same code as the main thread. */
export function serveSynthWorker(instruments: SynthInstrumentBank = {}): void {
  const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent<SynthWorkerRequest>) => void) | null;
    postMessage(message: SynthWorkerResponse, transfer?: Transferable[]): void;
  };
  scope.onmessage = (event) => {
    const { id, sound, sampleRate } = event.data;
    try {
      const sample = renderSynthSample(sound, sampleRate, instruments);
      scope.postMessage({ id, sample }, [sample.samples.buffer as ArrayBuffer]);
    } catch (error) {
      scope.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
