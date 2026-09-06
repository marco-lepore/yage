import type { LevelEntityClass } from "@yagejs/level";
import { describe, expect, it } from "vitest";
import { assembleProject } from "./assemble.js";

/**
 * A stand-in for a declared entity class. Assembly checks the shape of what the
 * modules exported and passes the classes through; whether one carries a usable
 * declaration is the catalog's question.
 */
function entityClass(id: string): LevelEntityClass {
  return { id } as unknown as LevelEntityClass;
}

describe("assembleProject", () => {
  it("takes a package the project also lists exactly once", () => {
    const shared = {
      packageName: "@yagejs/tilemap",
      entities: [entityClass("tilemap.layer")],
    };
    const assembled = assembleProject({
      project: {
        entities: [entityClass("game.crate")],
        contributions: [shared],
      },
      contributions: [shared],
    });

    // Composing it twice would declare tilemap.layer twice, which the catalog
    // reports as a duplicate type id rather than building.
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    expect(assembled.project.contributions).toEqual([shared]);
  });

  it("reports a project module that is not a level project", () => {
    const assembled = assembleProject({
      project: { notAProject: true },
      contributions: [],
    });

    expect(assembled.ok).toBe(false);
    expect(assembled.diagnostics[0]?.source).toBe("catalog");
    expect(assembled.diagnostics[0]?.code).toBe("catalog-invalid");
  });

  it("reports a contribution that is not one and keeps the rest", () => {
    const assembled = assembleProject({
      project: { entities: [entityClass("game.crate")] },
      contributions: [
        { packageName: "@broken/pkg" },
        {
          packageName: "@yagejs/tilemap",
          entities: [entityClass("tilemap.layer")],
        },
      ],
    });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    expect(
      assembled.project.contributions.map((one) => one.packageName),
    ).toEqual(["@yagejs/tilemap"]);
    // Skipping it in silence would leave that package's entity types missing
    // from the Actors panel with nothing said about why.
    expect(assembled.diagnostics).toHaveLength(1);
    expect(assembled.diagnostics[0]?.message).toContain(
      "Package contribution 0",
    );
  });
});
