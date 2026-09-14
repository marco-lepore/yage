import { describe, expect, it, vi } from "vitest";
import { tiledCommand, launchTiled } from "./tiled.js";

describe("opening a map in Tiled", () => {
  it.each([
    ["darwin", "open", ["-a", "Tiled", "/project/a map.json"], true],
    ["win32", "tiled.exe", ["/project/a map.json"], false],
    ["linux", "tiled", ["/project/a map.json"], false],
  ] as const)(
    "selects the %s launcher",
    (platform, executable, args, waitForExit) => {
      expect(
        tiledCommand("/project/a map.json", {
          platform,
          env: {},
          exists: () => false,
        }),
      ).toEqual({ executable, args, waitForExit });
    },
  );

  it("uses a configured executable as one argument, with no shell expansion", () => {
    expect(
      tiledCommand("/project/a & b.json", {
        platform: "win32",
        env: { YAGE_TILED_PATH: "D:\\My Apps\\tiled.exe" },
        exists: () => false,
      }),
    ).toEqual({
      executable: "D:\\My Apps\\tiled.exe",
      args: ["/project/a & b.json"],
      waitForExit: false,
    });
  });

  it("finds a standard Windows installation without requiring PATH changes", () => {
    expect(
      tiledCommand("C:\\game\\map.json", {
        platform: "win32",
        env: { ProgramFiles: "C:\\Program Files" },
        exists: () => true,
      }).executable,
    ).toBe("C:\\Program Files\\Tiled\\tiled.exe");
  });

  it("reports a real spawn failure without throwing out of the request", async () => {
    const result = await launchTiled("/game/map.json", {
      platform: "linux",
      env: { YAGE_TILED_PATH: "/yage-test-missing/tiled" },
      exists: () => false,
    });
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("ENOENT"),
    });
  });

  it("reports launch failures with the executable override the user can set", async () => {
    const run = vi.fn().mockRejectedValue(new Error("ENOENT"));
    expect(
      await launchTiled("/game/map.json", {
        run,
        platform: "linux",
        env: {},
        exists: () => false,
      }),
    ).toEqual({
      ok: false,
      message: expect.stringContaining("YAGE_TILED_PATH"),
    });
    expect(run).toHaveBeenCalledWith({
      executable: "tiled",
      args: ["/game/map.json"],
      waitForExit: false,
    });
  });
});
