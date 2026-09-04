import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTemplateId, TEMPLATES } from "./templates.js";

describe("templates registry", () => {
  const srcDir = fileURLToPath(new URL(".", import.meta.url));
  const packageRoot = resolve(srcDir, "..");
  const templatesRoot = join(packageRoot, "templates");

  it("lists both preset templates", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["recommended", "minimal"]);
  });

  it("recognises valid template ids", () => {
    expect(isTemplateId("recommended")).toBe(true);
    expect(isTemplateId("minimal")).toBe(true);
    expect(isTemplateId("xyz")).toBe(false);
  });

  it("has a directory on disk for every registered template", () => {
    for (const template of TEMPLATES) {
      const dir = join(templatesRoot, template.id);
      expect(existsSync(dir), `missing template dir: ${dir}`).toBe(true);
      expect(
        existsSync(join(dir, "_package.json")),
        `missing _package.json for ${template.id}`,
      ).toBe(true);
    }
  });

  it("declares the Node.js version required by Vite", () => {
    const packageManifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { engines?: { node?: string } };
    expect(packageManifest.engines?.node).toBe("^20.19.0 || >=22.12.0");

    for (const template of TEMPLATES) {
      const manifestPath = join(templatesRoot, template.id, "_package.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        engines?: { node?: string };
      };

      expect(manifest.engines?.node).toBe("^20.19.0 || >=22.12.0");
    }
  });

  it("keeps recommended guide paths in sync with the template", () => {
    const templateDir = join(templatesRoot, "recommended");
    const guide = readFileSync(join(templateDir, "AGENTS.md"), "utf8");
    const paths = [...guide.matchAll(/`((?:src|public)\/[^`\s]*)`/g)].flatMap(
      (match) => (match[1] === undefined ? [] : [match[1]]),
    );

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(
        existsSync(join(templateDir, path)),
        `missing guide path: ${path}`,
      ).toBe(true);
    }
  });
});
