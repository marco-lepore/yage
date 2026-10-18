import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  APP_ID_PATTERN,
  installedVersion,
  readManifest,
  WEB_DIRS,
  type GameManifest,
} from "./project.js";
import { HOST_PACKAGE, type Target } from "./types.js";

/** The module every target's entry imports the engine setup from. */
const BOOT_FILE = "src/boot.ts";

/** What counts as an exported boot function in the game's own source. */
const BOOT_EXPORT =
  /export\s+(async\s+)?function\s+boot\b|export\s+const\s+boot\b/;

/** What happened to one file or field. */
export type Outcome = "wrote" | "kept";

export interface InitFileResult {
  /** Path relative to the game's root. */
  readonly file: string;
  readonly outcome: Outcome;
}

export interface InitReport {
  readonly files: readonly InitFileResult[];
  readonly manifest: readonly InitFileResult[];
  /** Lines appended to `.gitignore`. */
  readonly ignored: readonly string[];
  /** What to run next. */
  readonly nextSteps: readonly string[];
  /** Anything the command could not fill in. */
  readonly notes: readonly string[];
}

export interface InitOptions {
  /** The game's root. */
  readonly root: string;
  readonly targets: readonly string[];
  /** The app's reverse-domain identifier. */
  readonly appId?: string;
  /** The app's display name. */
  readonly name?: string;
  /** Rewrite the files init would otherwise keep. */
  readonly force: boolean;
}

/**
 * Set a game up for the targets it names: the entry file each one boots
 * from, the Electron shell and the two vendor configuration files, the npm
 * scripts that build and package, and the identity both hosts read.
 *
 * Every check runs before the first write, and a file that is already there
 * is kept and named in the report unless `force` is set: after this command
 * the files are the game's.
 */
export function runInit(options: InitOptions): InitReport {
  const root = path.resolve(options.root);
  const manifest = readManifest(root);
  if (manifest === undefined) {
    throw new Error(
      `yage-pack init: no package.json in ${root}. Run this from the game's root directory.`,
    );
  }

  const targets = readTargets(options.targets);
  checkObjectField(manifest, "yage");
  checkObjectField(manifest, "scripts");
  checkBootModule(root);
  for (const target of targets) {
    const name = HOST_PACKAGE[target];
    if (installedVersion(root, name) === null) {
      throw new Error(
        `yage-pack init: ${name} is not installed. Run npm install ${name} first.`,
      );
    }
  }
  const appId = readAppId(options.appId, manifest);
  const displayName = readName(options.name, manifest);

  const hosts = new Set(
    targets.map((target) => (target === "electron" ? "electron" : "capacitor")),
  );
  const planned = plannedFiles(hosts);
  for (const file of planned.keys()) {
    const full = path.join(root, file);
    if (existsSync(full) && statSync(full).isDirectory()) {
      throw new Error(`yage-pack init: ${full} is a directory.`);
    }
  }

  const files: InitFileResult[] = [];
  for (const [file, body] of planned) {
    files.push({
      file,
      outcome: write(path.join(root, file), body(displayName), options.force),
    });
  }

  const notes: string[] = [];
  const fields = updateManifest(root, manifest, {
    appId,
    name: displayName,
    hosts,
    explicitName: options.name !== undefined,
    notes,
  });

  return {
    files,
    manifest: fields,
    ignored: updateGitignore(root, hosts),
    nextSteps: nextSteps(targets),
    notes,
  };
}

function readTargets(raw: readonly string[]): Target[] {
  if (raw.length === 0) {
    throw new Error(
      "yage-pack init: --target must be electron, ios or android, got nothing.",
    );
  }
  return raw.map((value) => {
    if (value !== "electron" && value !== "ios" && value !== "android") {
      throw new Error(
        `yage-pack init: --target must be electron, ios or android, got ${JSON.stringify(value)}.`,
      );
    }
    return value;
  });
}

/** `init` adds keys to these fields, so each has to be an object when present. */
function checkObjectField(
  manifest: GameManifest,
  field: "yage" | "scripts",
): void {
  const value: unknown = manifest[field];
  if (value === undefined || value === null) return;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `yage-pack init: package.json "${field}" must be an object, got ${JSON.stringify(value)}.`,
    );
  }
}

function checkBootModule(root: string): void {
  const file = path.join(root, BOOT_FILE);
  if (existsSync(file) && BOOT_EXPORT.test(readFileSync(file, "utf8"))) return;
  throw new Error(
    `yage-pack init: ${BOOT_FILE} with an exported boot function is missing. ` +
      `Move the engine setup out of the web entry into ${BOOT_FILE} ` +
      `("One boot function" in the packaging guide), then run init again.`,
  );
}

function readAppId(flag: string | undefined, manifest: GameManifest): string {
  const declared = manifest.yage?.appId;
  const existing = typeof declared === "string" ? declared : undefined;
  if (flag === undefined && existing === undefined) {
    throw new Error(
      "yage-pack init: pass --app-id, the app's reverse-domain identifier " +
        "(for example com.example.mygame). It names the save directory and " +
        "must not change after the first release.",
    );
  }
  if (flag !== undefined && existing !== undefined && flag !== existing) {
    throw new Error(
      `yage-pack init: --app-id ${flag} differs from package.json "yage.appId" ${existing}. ` +
        `Changing it moves every player's saves; edit package.json yourself if that is intended.`,
    );
  }
  const appId = flag ?? (existing as string);
  if (!APP_ID_PATTERN.test(appId)) {
    const source =
      flag === undefined ? 'package.json "yage.appId"' : "--app-id";
    throw new Error(
      `yage-pack init: ${source} must match ${APP_ID_PATTERN.source}, got ${JSON.stringify(appId)}.`,
    );
  }
  return appId;
}

function readName(flag: string | undefined, manifest: GameManifest): string {
  const candidates = [
    flag,
    typeof manifest.productName === "string" ? manifest.productName : undefined,
    typeof manifest.name === "string" ? manifest.name : undefined,
  ];
  const name = candidates.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (name === undefined) {
    throw new Error("yage-pack init: pass --name, the app's display name.");
  }
  return name;
}

type Host = "electron" | "capacitor";

/** The files each host adds, in the order the report lists them. */
function plannedFiles(
  hosts: ReadonlySet<string>,
): Map<string, (name: string) => string> {
  const planned = new Map<string, (name: string) => string>();
  if (hosts.has("electron")) {
    planned.set("src/main.electron.ts", () => ELECTRON_ENTRY);
    planned.set("electron/main.cjs", () => ELECTRON_SHELL);
    planned.set("forge.config.cjs", () => FORGE_CONFIG);
  }
  if (hosts.has("capacitor")) {
    planned.set("src/main.capacitor.ts", () => CAPACITOR_ENTRY);
    planned.set("capacitor.config.ts", () => CAPACITOR_CONFIG);
  }
  return planned;
}

const ELECTRON_ENTRY = `import { ElectronHostPlugin } from "@yagejs/host-electron";
import { boot } from "./boot";

boot({ hostPlugins: [new ElectronHostPlugin()] }).catch((err) => {
  console.error(err);
});
`;

const CAPACITOR_ENTRY = `import { CapacitorHostPlugin } from "@yagejs/host-capacitor";
import { boot } from "./boot";

boot({ hostPlugins: [new CapacitorHostPlugin()] }).catch((err) => {
  console.error(err);
});
`;

const ELECTRON_SHELL = `// The Electron shell: one window serving the Electron build.
const { app } = require("electron");
const path = require("node:path");
const { startGame } = require("@yagejs/host-electron/main");
const { productName, yage } = require("../package.json");

startGame({
  webDir: path.join(__dirname, "..", "${WEB_DIRS.electron}"),
  appId: yage.appId,
  // A packaged app is a release; electron-forge start runs unpackaged.
  profile: app.isPackaged ? "release" : "development",
  devTools: !app.isPackaged,
  window: { width: 1280, height: 720, title: productName },
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
`;

const FORGE_CONFIG = `const { electronForgeConfig } = require("@yagejs-tools/pack/forge");

module.exports = electronForgeConfig();
`;

const CAPACITOR_CONFIG = `import { capacitorConfig } from "@yagejs-tools/pack/capacitor";

export default capacitorConfig();
`;

function write(file: string, body: string, force: boolean): Outcome {
  if (existsSync(file) && !force) return "kept";
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  return "wrote";
}

interface ManifestUpdate {
  readonly appId: string;
  readonly name: string;
  readonly hosts: ReadonlySet<string>;
  readonly explicitName: boolean;
  readonly notes: string[];
}

function updateManifest(
  root: string,
  manifest: GameManifest,
  update: ManifestUpdate,
): InitFileResult[] {
  const file = path.join(root, "package.json");
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const results: InitFileResult[] = [];

  // The identifier, not the name, is what keeps a player's saves, so a new
  // display name replaces the old one and the identifier never does.
  const hasName = typeof raw.productName === "string" && raw.productName !== "";
  if (!hasName || update.explicitName) {
    raw.productName = update.name;
    results.push({ file: "productName", outcome: "wrote" });
  } else {
    results.push({ file: "productName", outcome: "kept" });
  }

  const yage = (raw.yage ?? {}) as Record<string, unknown>;
  if (typeof yage.appId === "string") {
    results.push({ file: "yage.appId", outcome: "kept" });
  } else {
    yage.appId = update.appId;
    raw.yage = yage;
    results.push({ file: "yage.appId", outcome: "wrote" });
  }

  if (update.hosts.has("electron")) {
    if (typeof raw.main === "string" && raw.main !== "") {
      results.push({ file: "main", outcome: "kept" });
    } else {
      raw.main = "electron/main.cjs";
      results.push({ file: "main", outcome: "wrote" });
    }
  }

  const scripts = (raw.scripts ?? {}) as Record<string, string>;
  for (const [name, command] of plannedScripts(root, manifest, update)) {
    if (typeof scripts[name] === "string") {
      results.push({ file: `scripts.${name}`, outcome: "kept" });
      continue;
    }
    scripts[name] = command;
    results.push({ file: `scripts.${name}`, outcome: "wrote" });
  }
  raw.scripts = scripts;

  writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
  return results;
}

/** The scripts each host adds, and the build command they share. */
function plannedScripts(
  root: string,
  manifest: GameManifest,
  update: ManifestUpdate,
): [string, string][] {
  const declared = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  const hasVite = declared.vite !== undefined;
  const hasTypescript =
    declared.typescript !== undefined &&
    existsSync(path.join(root, "tsconfig.json"));
  const build = (target: Host): string | undefined => {
    if (!hasVite) return undefined;
    const command = `vite build --mode ${target}`;
    return hasTypescript ? `tsc --noEmit && ${command}` : command;
  };

  const scripts: [string, string][] = [];
  if (update.hosts.has("electron")) {
    const command = build("electron");
    if (command === undefined) {
      update.notes.push(
        `No build:electron script was written: add one that writes ${WEB_DIRS.electron}/. ` +
          "start:electron, package:electron and make:electron run it.",
      );
    } else {
      scripts.push(["build:electron", command]);
    }
    scripts.push(
      ["start:electron", "npm run build:electron && electron-forge start"],
      ["package:electron", "npm run build:electron && electron-forge package"],
      ["make:electron", "npm run build:electron && electron-forge make"],
    );
  }
  if (update.hosts.has("capacitor")) {
    const command = build("capacitor");
    if (command === undefined) {
      update.notes.push(
        `No build:capacitor script was written: add one that writes ${WEB_DIRS.capacitor}/. ` +
          "sync:capacitor runs it.",
      );
    } else {
      scripts.push(["build:capacitor", command]);
    }
    scripts.push(
      ["sync:capacitor", "npm run build:capacitor && cap sync"],
      // Capacitor spawns a hook with the inherited PATH, which holds
      // node_modules/.bin under npm run and npx cap.
      ["capacitor:sync:after", "npx yage-pack check"],
    );
  }
  return scripts;
}

function updateGitignore(root: string, hosts: ReadonlySet<string>): string[] {
  const wanted: string[] = [];
  if (hosts.has("electron")) wanted.push(WEB_DIRS.electron, "out");
  if (hosts.has("capacitor")) wanted.push(WEB_DIRS.capacitor);
  const file = path.join(root, ".gitignore");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = existing.split("\n").map((line) => line.trim());
  const added = wanted.filter((entry) => !lines.includes(entry));
  if (added.length === 0) return [];
  const body =
    existing.length === 0 || existing.endsWith("\n")
      ? existing
      : `${existing}\n`;
  writeFileSync(file, `${body}${added.join("\n")}\n`);
  return added;
}

function nextSteps(targets: readonly Target[]): string[] {
  const ios = targets.includes("ios");
  const android = targets.includes("android");
  const steps: string[] = [];
  if (targets.includes("electron")) steps.push("npm run start:electron");
  if (ios || android) steps.push("npm run build:capacitor");
  if (ios) steps.push("npx cap add ios --packagemanager SPM");
  if (android) steps.push("npx cap add android");
  if (ios) steps.push("npx cap open ios");
  return steps;
}

/** One init report as a person reads it. */
export function initText(report: InitReport): string {
  const lines: string[] = [];
  for (const result of [...report.files, ...report.manifest]) {
    lines.push(
      `${result.outcome === "wrote" ? "wrote" : "kept "} ${result.file}`,
    );
  }
  for (const entry of report.ignored) lines.push(`wrote .gitignore ${entry}`);
  for (const note of report.notes) lines.push(note);
  if (report.nextSteps.length > 0) {
    lines.push("", "Next:");
    for (const step of report.nextSteps) lines.push(`  ${step}`);
  }
  return lines.join("\n");
}
