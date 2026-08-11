import { describe, expect, it } from "vitest";
import type { TilemapDiagnostic, TilemapDiagnosticCode } from "../types.js";
import { validateTiledMap } from "./diagnostics.js";
import { loadFixture } from "./fixtures/loadFixture.js";
import type { TiledMapData } from "./types.js";

function diagnostic(
  code: TilemapDiagnosticCode,
  fixture: string,
): TilemapDiagnostic | undefined {
  return validateTiledMap(loadFixture(fixture)).find(
    (entry) => entry.code === code,
  );
}

describe("validateTiledMap", () => {
  it("reports unsupported map and layer forms as errors", () => {
    expect(
      diagnostic("unsupported-orientation", "isometric.json")?.severity,
    ).toBe("error");
    expect(diagnostic("encoded-layer-data", "base64.json")?.severity).toBe(
      "error",
    );
    expect(diagnostic("group-layer", "group.json")?.severity).toBe("error");
    expect(diagnostic("image-layer", "image-layer.json")?.severity).toBe(
      "error",
    );
    expect(diagnostic("tsx-tileset", "tsx.json")?.severity).toBe("error");
    expect(
      diagnostic("unresolved-tileset", "unresolved-inline.json")?.severity,
    ).toBe("error");
  });

  it("reports only the map and chunk errors for an infinite chunked layer", () => {
    expect(
      validateTiledMap(loadFixture("infinite-chunked.json")).map((entry) => ({
        code: entry.code,
        severity: entry.severity,
      })),
    ).toEqual([
      { code: "infinite-map", severity: "error" },
      { code: "chunked-layer", severity: "error" },
    ]);
  });

  it("names nested layers dropped with a group", () => {
    const entry = diagnostic("group-layer", "group.json");
    expect(entry?.message).toContain("nested ground");
  });

  it("does not warn about a conforming animation", () => {
    const diagnostics = validateTiledMap(loadFixture("animated-parallax.json"));
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "layer-parallax",
        severity: "warning",
      }),
    ]);
  });

  it.each([
    ["animation-unequal-durations.json", "Tile 0", "durations differ"],
    ["animation-uneven-stride.json", "Tile 0", "stride varies"],
    ["animation-collection.json", "Tile 0", "separate image"],
  ])("reports an unsupported animation in %s", (fixture, tile, reason) => {
    const diagnostics = validateTiledMap(loadFixture(fixture));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual(
      expect.objectContaining({
        code: "unsupported-tile-animation",
        severity: "warning",
      }),
    );
    expect(diagnostics[0]?.message).toContain(tile);
    expect(diagnostics[0]?.message.toLowerCase()).toContain(reason);
  });

  it("does not warn about a single-frame animation", () => {
    expect(
      validateTiledMap(loadFixture("animation-single-frame.json")),
    ).toEqual([]);
  });

  it("reports no diagnostics for a plain orthogonal map", () => {
    expect(validateTiledMap(loadFixture("clean.json"))).toEqual([]);
  });

  it("reports no diagnostics for a raw external JSON tileset reference", () => {
    expect(validateTiledMap(loadFixture("external-tsj.json"))).toEqual([]);
  });

  it("reports the tile objects on a layer as one error", () => {
    const entry = diagnostic("tile-object", "tile-objects.json");

    expect(entry?.severity).toBe("error");
    expect(entry?.layer).toBe("props");
    for (const name of ["chest", "flipped", "lamp", "turned"]) {
      expect(entry?.message).toContain(name);
    }
    expect(entry?.message).not.toContain("trigger");
    expect(validateTiledMap(loadFixture("tile-objects.json"))).toHaveLength(1);
  });

  it("reports nothing for object layers and tile sizes it handles", () => {
    expect(validateTiledMap(loadFixture("object-groups.json"))).toEqual([]);
    expect(validateTiledMap(loadFixture("oversized-tiles.json"))).toEqual([]);
  });

  it("does not throw when map fields contain malformed values", () => {
    const malformed = {
      orientation: { unexpected: true },
      infinite: true,
      layers: [null, { type: "group", name: 42, layers: [false] }],
      tilesets: [
        null,
        { source: 42 },
        {
          firstgid: 1,
          name: "broken",
          tilewidth: 16,
          tileheight: 16,
          tilecount: 1,
          columns: 1,
          properties: [null],
          tiles: [null],
        },
      ],
    } as unknown as TiledMapData;

    expect(() => validateTiledMap(malformed)).not.toThrow();
  });
});
