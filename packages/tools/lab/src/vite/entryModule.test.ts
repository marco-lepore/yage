import { describe, expect, it } from "vitest";
import { renderEntryModule } from "./entryModule.js";
import { LAB_HOST_ID } from "./labHtml.js";

const options = {
  harness: "/lab/harness.ts",
  patterns: ["/src/**/*.scenario.ts", "!**/dist/**"],
  root: "/src",
};

describe("renderEntryModule", () => {
  it("imports the project's harness", () => {
    expect(renderEntryModule(options)).toContain(
      'import harness from "/lab/harness.ts"',
    );
  });

  it("writes the patterns into the glob as a literal", () => {
    // Vite reads the pattern at transform time, so it cannot come from a
    // variable.
    expect(renderEntryModule(options)).toContain(
      'import.meta.glob(["/src/**/*.scenario.ts","!**/dist/**"], { eager: true })',
    );
  });

  it("passes the root the ids are derived against", () => {
    expect(renderEntryModule(options)).toContain('root: "/src"');
  });

  it("mounts into the host the generated page provides", () => {
    expect(renderEntryModule(options)).toContain(
      `document.getElementById("${LAB_HOST_ID}")`,
    );
  });
});
