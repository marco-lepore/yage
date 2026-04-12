import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTemplateId, TEMPLATES } from "./templates.js";

describe("templates registry", () => {
  it("lists both preset templates", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["recommended", "minimal"]);
  });

  it("recognises valid template ids", () => {
    expect(isTemplateId("recommended")).toBe(true);
    expect(isTemplateId("minimal")).toBe(true);
    expect(isTemplateId("xyz")).toBe(false);
  });

  it("has a directory on disk for every registered template", () => {
    const srcDir = fileURLToPath(new URL(".", import.meta.url));
    const templatesRoot = resolve(srcDir, "..", "templates");
    for (const template of TEMPLATES) {
      const dir = join(templatesRoot, template.id);
      expect(existsSync(dir), `missing template dir: ${dir}`).toBe(true);
      expect(
        existsSync(join(dir, "_package.json")),
        `missing _package.json for ${template.id}`,
      ).toBe(true);
    }
  });
});
