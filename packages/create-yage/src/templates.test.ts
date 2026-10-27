import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isTemplateId, TEMPLATES } from "./templates.js";
import { copyTemplateDirectory } from "./utils.js";

/** The entry files `yage-pack init` writes for the desktop and mobile targets. */
const HOST_ENTRIES = ["src/main.electron.ts", "src/main.capacitor.ts"];

/**
 * Run `yage-pack init` on a copy of a template and return the entry files it
 * wrote, by their path relative to the game's root.
 */
async function initEntries(templateDir: string): Promise<Map<string, string>> {
  const game = mkdtempSync(join(tmpdir(), "create-yage-init-"));
  try {
    await copyTemplateDirectory(templateDir, game);
    // init reads only that each host package is installed.
    for (const name of ["@yagejs/host-electron", "@yagejs/host-capacitor"]) {
      const dir = join(game, "node_modules", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name, version: "0.12.0" }),
      );
    }
    const cli = join(
      dirname(createRequire(import.meta.url).resolve("@yagejs-tools/pack")),
      "cli.js",
    );
    execFileSync(
      process.execPath,
      [
        cli,
        "init",
        "--target",
        "electron",
        "--target",
        "ios",
        "--app-id",
        "com.example.mygame",
      ],
      { cwd: game, stdio: "pipe" },
    );
    return new Map(
      HOST_ENTRIES.map((file) => [
        file,
        readFileSync(join(game, file), "utf8"),
      ]),
    );
  } finally {
    rmSync(game, { recursive: true, force: true });
  }
}

/**
 * Type-check a template's sources with its own compiler options, plus the
 * given files placed in its directory without writing them there. Packages
 * resolve from this repository, so the check reads the built declarations.
 */
function typeErrors(
  templateDir: string,
  extra: ReadonlyMap<string, string>,
): string {
  const config = ts.readConfigFile(join(templateDir, "tsconfig.json"), (file) =>
    ts.sys.readFile(file),
  );
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    templateDir,
  );
  // A scaffolded game has none of this repository's @types packages.
  const options = { ...parsed.options, types: [] };
  const virtual = new Map(
    [...extra].map(([file, text]) => [join(templateDir, file), text]),
  );
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (file) => virtual.get(file) ?? readFile(file);
  host.fileExists = (file) => virtual.has(file) || fileExists(file);
  host.getSourceFile = (file, language, ...rest) => {
    const text = virtual.get(file);
    return text === undefined
      ? getSourceFile(file, language, ...rest)
      : ts.createSourceFile(file, text, language);
  };
  const program = ts.createProgram(
    [...parsed.fileNames, ...virtual.keys()],
    options,
    host,
  );
  return ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => templateDir,
    getNewLine: () => "\n",
  });
}

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

  it("boots every target from one module that calls nothing itself", () => {
    for (const template of TEMPLATES) {
      const dir = join(templatesRoot, template.id);
      const boot = readFileSync(join(dir, "src", "boot.ts"), "utf8");
      expect(boot).toContain("export async function boot(");
      expect(boot).not.toMatch(/^\s*(boot|main)\(/m);

      expect(boot).toContain("readonly saveAdapter: SaveAdapter;");
      expect(boot).toContain(
        "new SavePlugin({ save: createSave({ adapter: options.saveAdapter }) })",
      );

      const web = readFileSync(join(dir, "src", "main.web.ts"), "utf8");
      expect(web).toContain("hostPlugins: [],");
      expect(web).toContain(
        'saveAdapter: localStorageAdapter({ namespace: "my-yage-game" }),',
      );

      const manifest = JSON.parse(
        readFileSync(join(dir, "_package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };
      expect(manifest.dependencies).toHaveProperty("@yagejs/save");

      const page = readFileSync(join(dir, "index.html"), "utf8");
      expect(page).toContain('src="/src/main.web.ts"');

      const vite = readFileSync(join(dir, "vite.config.ts"), "utf8");
      expect(vite).toContain('name: "target-entry"');
      expect(vite).toContain('mode === "electron" || mode === "capacitor"');
      expect(vite).toContain(
        'outDir: target === "web" ? "dist" : `dist-${target}`',
      );
    }
  });

  it.each(TEMPLATES.map((template) => template.id))(
    "compiles the %s template with the entries yage-pack init writes",
    async (id) => {
      const dir = join(templatesRoot, id);
      const entries = await initEntries(dir);
      expect(entries.get("src/main.electron.ts")).toContain(
        "saveAdapter: electronSaveAdapter(),",
      );
      expect(entries.get("src/main.capacitor.ts")).toContain(
        "saveAdapter: capacitorSaveAdapter(),",
      );
      expect(typeErrors(dir, entries)).toBe("");
    },
    60_000,
  );

  it("installs the service worker in the browser build only", () => {
    const vite = readFileSync(
      join(templatesRoot, "recommended", "vite.config.ts"),
      "utf8",
    );
    expect(vite).toMatch(/target === "web"\s*\?\s*\[\s*\n?\s*VitePWA\(/);
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
