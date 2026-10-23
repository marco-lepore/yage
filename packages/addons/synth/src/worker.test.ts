import { afterEach, expect, it, vi } from "vitest";
import { serveSynthWorker } from "./worker.js";
import { flute } from "./instruments/flute.js";
import { hat } from "./test-helpers.js";

const post = vi.fn();
afterEach(() => vi.unstubAllGlobals());
function request(sound: unknown): void {
  vi.stubGlobal("postMessage", post);
  vi.stubGlobal("onmessage", null);
  post.mockClear();
  serveSynthWorker({ flute });
  const handler: (event: MessageEvent) => void = globalThis.onmessage!;
  handler(
    new MessageEvent("message", {
      data: { id: 7, sampleRate: 8000, sound },
    }),
  );
}
it("renders a supplied instrument in the worker and transfers its sample buffer", () => {
  const sound = flute.sound({ seed: 19 });
  request(sound);
  const sample = flute.render({ seed: 19 }, 8000);
  expect(post).toHaveBeenCalledWith({ id: 7, sample }, [
    expect.any(ArrayBuffer),
  ]);
});
it("reports an instrument missing from the worker's set", () => {
  request({ instrument: "banjo" });
  expect(post).toHaveBeenCalledWith({
    id: 7,
    error: 'renderSynthInstrument: instrument "banjo" is not registered.',
  });
});
it("renders a custom instrument the worker was given", () => {
  vi.stubGlobal("postMessage", post);
  vi.stubGlobal("onmessage", null);
  post.mockClear();
  serveSynthWorker({ hat });
  const handler: (event: MessageEvent) => void = globalThis.onmessage!;
  handler(
    new MessageEvent("message", {
      data: { id: 3, sampleRate: 8000, sound: hat.sound({ seed: 5 }) },
    }),
  );
  expect(post).toHaveBeenCalledWith(
    { id: 3, sample: hat.render({ seed: 5 }, 8000) },
    [expect.any(ArrayBuffer)],
  );
});
