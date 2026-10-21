import { kick } from "./instruments/kick.js";
import { pad } from "./instruments/pad.js";
const instruments = { kick, pad };
import { afterEach, expect, it, vi } from "vitest";
import { RenderBank } from "./renderBank.js";
import { renderSynthSample } from "./core/sample.js";
import type { SynthWorkerRequest } from "./worker.js";
import type { SynthSound } from "./core/types.js";
class TestWorker extends EventTarget {
  requests: SynthWorkerRequest[] = [];
  terminate = vi.fn();
  postMessage(message: SynthWorkerRequest): void {
    this.requests.push(message);
  }
  asWorker(): Worker {
    return this as unknown as Worker;
  }
  answer(id: number): void {
    const request = this.requests[id]!;
    this.dispatchEvent(
      new MessageEvent("message", {
        data: {
          id,
          sample: renderSynthSample(
            request.sound,
            request.sampleRate,
            instruments,
          ),
        },
      }),
    );
  }
}
const sounds: SynthSound[] = [
  { instrument: "kick", seed: 42 },
  { instrument: "pad", seed: 9 },
];
afterEach(() => vi.useRealTimers());
it("returns worker samples in authored order with the same seeded samples and sustain region", async () => {
  const worker = new TestWorker();
  const bank = new RenderBank(worker.asWorker(), 500, instruments);
  const pending = bank.render(sounds, 8000);
  worker.answer(1);
  worker.answer(0);
  expect(await pending).toEqual(
    sounds.map((s) => renderSynthSample(s, 8000, instruments)),
  );
  expect(bank.diagnostics).toMatchObject({
    mode: "worker",
    completed: 2,
    fallbackReason: null,
  });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("falls back after a stalled worker and exposes the reason", async () => {
  vi.useFakeTimers();
  const worker = new TestWorker();
  const bank = new RenderBank(worker.asWorker(), 500, instruments);
  const pending = bank.render(sounds, 8000);
  worker.answer(0);
  await vi.advanceTimersByTimeAsync(500);
  expect(await pending).toEqual(
    sounds.map((s) => renderSynthSample(s, 8000, instruments)),
  );
  expect(bank.diagnostics).toMatchObject({
    mode: "main",
    completed: 2,
    fallbackReason: "Worker render timed out.",
  });
});
it("reports transport failure before falling back", async () => {
  const worker = new TestWorker();
  const bank = new RenderBank(worker.asWorker(), 500, instruments);
  const pending = bank.render(sounds, 8000);
  worker.dispatchEvent(new Event("messageerror"));
  expect(await pending).toHaveLength(2);
  expect(bank.diagnostics.fallbackReason).toBe("Worker messageerror");
});
it("rejects authored render errors instead of concealing them with fallback", async () => {
  const worker = new TestWorker();
  const bank = new RenderBank(worker.asWorker(), 500, instruments);
  const pending = bank.render(sounds, 8000);
  const assertion = expect(pending).rejects.toThrow("bad patch");
  worker.dispatchEvent(
    new MessageEvent("message", { data: { id: 0, error: "bad patch" } }),
  );
  await assertion;
  expect(bank.diagnostics.fallbackReason).toBeNull();
});
it("cancels pending rendering on disposal", async () => {
  const worker = new TestWorker();
  const bank = new RenderBank(worker.asWorker(), 500, instruments);
  const pending = bank.render(sounds, 8000);
  const assertion = expect(pending).rejects.toThrow("disposed");
  bank.dispose();
  await assertion;
  expect(bank.diagnostics.state).toBe("disposed");
});
it("rejects a missing fallback instrument before sending worker messages", async () => {
  const worker = new TestWorker();
  const bank = new RenderBank(worker.asWorker(), 500, { kick });
  await expect(bank.render(sounds, 8000)).rejects.toThrow(
    '"pad" is not registered',
  );
  expect(worker.requests).toHaveLength(0);
  bank.dispose();
});
