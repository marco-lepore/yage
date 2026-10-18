import { describe, expect, it, vi } from "vitest";
import { CHANNELS, HOST_BRIDGE_PROTOCOL } from "../protocol.js";
import { createBridge } from "./createBridge.js";
import type { BridgeIpc } from "./createBridge.js";

function fakeIpc() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const ipc = {
    invoke: vi.fn().mockResolvedValue("answer"),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      const set = handlers.get(channel) ?? new Set();
      set.add(handler);
      handlers.set(channel, set);
    }),
    removeListener: vi.fn(
      (channel: string, handler: (...args: unknown[]) => void) => {
        handlers.get(channel)?.delete(handler);
      },
    ),
  };
  return { ipc: ipc as unknown as BridgeIpc, handlers, calls: ipc };
}

describe("createBridge", () => {
  it("reports the protocol the page checks", () => {
    expect(createBridge(fakeIpc().ipc).protocol).toBe(HOST_BRIDGE_PROTOCOL);
  });

  it("sends each operation on its own channel", async () => {
    const { ipc, calls } = fakeIpc();
    const bridge = createBridge(ipc);
    await bridge.start();
    await bridge.setFullscreen(true);
    await bridge.saves.read("k");
    await bridge.saves.write("k", "v");
    await bridge.saves.delete("k");
    await bridge.saves.list("p");
    expect(calls.invoke.mock.calls).toEqual([
      [CHANNELS.start],
      [CHANNELS.fullscreen, true],
      [CHANNELS.savesRead, "k"],
      [CHANNELS.savesWrite, "k", "v"],
      [CHANNELS.savesDelete, "k"],
      [CHANNELS.savesList, "p"],
    ]);
  });

  it("hands the page the state without the message it came in", () => {
    const { ipc, handlers } = fakeIpc();
    const bridge = createBridge(ipc);
    const seen: unknown[] = [];
    const stop = bridge.onState((state) => seen.push(state));
    const installed = [...handlers.get(CHANNELS.state)!];
    expect(installed).toHaveLength(1);
    installed[0]!({ sender: "ipc" }, { revision: 3 });
    expect(seen).toEqual([{ revision: 3 }]);

    const other = bridge.onState(() => {});
    stop();
    expect(handlers.get(CHANNELS.state)!.size).toBe(1);
    other();
    expect(handlers.get(CHANNELS.state)!.size).toBe(0);
  });
});
