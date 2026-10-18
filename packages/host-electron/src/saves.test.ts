import { afterEach, describe, expect, it, vi } from "vitest";
import { electronSaveAdapter } from "./saves.js";
import { HOST_BRIDGE_PROTOCOL } from "./protocol.js";

function expose(value: unknown): void {
  (globalThis as { __yageHost__?: unknown }).__yageHost__ = value;
}

afterEach(() => {
  delete (globalThis as { __yageHost__?: unknown }).__yageHost__;
});

describe("electronSaveAdapter", () => {
  it("reports what to do when the page has no shell", () => {
    expect(() => electronSaveAdapter()).toThrowError(
      "electronSaveAdapter: no YAGE host bridge on this page. Load the game " +
        "in a shell that runs the @yagejs/host-electron preload script, or " +
        "leave this adapter out of a browser build.",
    );
    expose({ protocol: "1" });
    expect(() => electronSaveAdapter()).toThrowError(
      'electronSaveAdapter: the shell\'s host bridge reports protocol "1", ' +
        "expected a positive integer.",
    );
    expose({ protocol: HOST_BRIDGE_PROTOCOL + 1 });
    expect(() => electronSaveAdapter()).toThrowError(
      /^electronSaveAdapter: the shell speaks host bridge protocol 2 /,
    );
  });

  it("forwards each operation to the shell", async () => {
    const saves = {
      read: vi.fn().mockResolvedValue("value"),
      write: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue(["a", "b"]),
    };
    expose({ protocol: HOST_BRIDGE_PROTOCOL, saves });
    const adapter = electronSaveAdapter();

    await expect(adapter.read("k")).resolves.toBe("value");
    await adapter.write("k", "v");
    await adapter.delete("k");
    await expect(adapter.list("p")).resolves.toEqual(["a", "b"]);

    expect(saves.read).toHaveBeenCalledWith("k");
    expect(saves.write).toHaveBeenCalledWith("k", "v");
    expect(saves.delete).toHaveBeenCalledWith("k");
    expect(saves.list).toHaveBeenCalledWith("p");
  });

  it("passes a refusal from the shell through", async () => {
    const failure = new Error(
      "yage:saves:write: key must be a string, got number.",
    );
    expose({
      protocol: HOST_BRIDGE_PROTOCOL,
      saves: {
        read: vi.fn(),
        write: vi.fn().mockRejectedValue(failure),
        delete: vi.fn(),
        list: vi.fn(),
      },
    });
    await expect(electronSaveAdapter().write("k", "v")).rejects.toThrowError(
      failure.message,
    );
  });
});
