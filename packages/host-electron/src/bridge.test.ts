import { afterEach, describe, expect, it } from "vitest";
import { requireHostBridge } from "./bridge.js";
import { HOST_BRIDGE_PROTOCOL } from "./protocol.js";

function expose(value: unknown): void {
  (globalThis as { __yageHost__?: unknown }).__yageHost__ = value;
}

afterEach(() => {
  delete (globalThis as { __yageHost__?: unknown }).__yageHost__;
});

describe("requireHostBridge", () => {
  it("names the shell and what to leave out when no bridge is there", () => {
    expect(() =>
      requireHostBridge("ElectronHostPlugin.install", "plugin"),
    ).toThrowError(
      "ElectronHostPlugin.install: no YAGE host bridge on this page. " +
        "Load the game in a shell that runs the @yagejs/host-electron " +
        "preload script, or leave this plugin out of a browser build.",
    );
    expose(null);
    expect(() =>
      requireHostBridge("electronSaveAdapter", "adapter"),
    ).toThrowError(
      "electronSaveAdapter: no YAGE host bridge on this page. Load the " +
        "game in a shell that runs the @yagejs/host-electron preload " +
        "script, or leave this adapter out of a browser build.",
    );
  });

  it("rejects a protocol that is not a positive integer", () => {
    for (const protocol of ["1", 0, 1.5, null, undefined]) {
      expose({ protocol });
      expect(() =>
        requireHostBridge("electronSaveAdapter", "adapter"),
      ).toThrowError(
        "electronSaveAdapter: the shell's host bridge reports protocol " +
          `${JSON.stringify(protocol)}, expected a positive integer.`,
      );
    }
  });

  it("rejects a shell that speaks another protocol", () => {
    expose({ protocol: 2 });
    expect(() =>
      requireHostBridge("ElectronHostPlugin.install", "plugin"),
    ).toThrowError(
      "ElectronHostPlugin.install: the shell speaks host bridge protocol " +
        `2 and this game was built with protocol ${HOST_BRIDGE_PROTOCOL}. ` +
        "Build the shell and the game with the same @yagejs/host-electron " +
        "version.",
    );
  });

  it("returns a bridge that speaks this protocol", () => {
    const bridge = { protocol: HOST_BRIDGE_PROTOCOL };
    expose(bridge);
    expect(requireHostBridge("electronSaveAdapter", "adapter")).toBe(bridge);
  });
});
