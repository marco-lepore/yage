import { relative } from "node:path";
import { synthInstruments } from "@yagejs-addons/synth/instruments";
import type {
  SynthInstrumentBank,
  SynthInstrumentDefinition,
} from "@yagejs-addons/synth/render";
import type * as Vite from "vite";

/** A game's instrument module, imported through the game's own Vite. */
export interface InstrumentModule {
  /**
   * Import the module from disk again and return the built-in instruments
   * plus every instrument definition it exports.
   */
  load(): Promise<SynthInstrumentBank>;
  /** The source files the last `load` imported, the module first. */
  readonly files: readonly string[];
  close(): Promise<void>;
}

/**
 * Start a Vite server on `root`, with the project's own Vite config, to import
 * the instrument module at `path`. Imports resolve the way the game's build
 * resolves them: aliases, extensionless and `.js` imports of `.ts` files, and
 * modules split across files.
 */
export async function openInstrumentModule(
  path: string,
  root: string,
): Promise<InstrumentModule> {
  const vite = await importVite();
  const server = await vite.createServer({
    root,
    // No page is served and no browser connects: the server is here to import
    // one module and its imports.
    appType: "custom",
    logLevel: "warn",
    server: { middlewareMode: true, ws: false },
    // The client dependency optimizer prebundles for a browser, and no browser
    // joins this run.
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        // The CLI polls the files it imports, so Vite opens no watcher over
        // the project. Set here rather than inline: merging the project's
        // config drops an inline `watch: null` when it has a `server` block.
        name: "yage-audio:no-watcher",
        config(config) {
          (config.server ??= {}).watch = null;
        },
      },
    ],
  });
  const graph = server.environments.ssr.moduleGraph;
  const label = relative(root, path) || path;
  // Vite keys its module graph by forward-slash paths.
  const entry = vite.normalizePath(path);
  let files: readonly string[] = [entry];
  return {
    get files() {
      return files;
    },
    async load() {
      // Vite watches nothing here, so every load reads the files again.
      graph.invalidateAll();
      let exports: Record<string, unknown>;
      try {
        exports = await server.ssrLoadModule(path);
      } catch (error) {
        throw new Error(
          `AudioBank: failed to import ${label}: ${importFailure(error)}`,
          { cause: error },
        );
      } finally {
        // After a failed import too: the files that did load are the ones a
        // fix is saved to.
        files = importedFiles(graph, entry);
      }
      return instrumentBank(exports, label);
    },
    close: () => server.close(),
  };
}

/**
 * The built-in instruments plus every instrument definition among a module's
 * exports. An export named like a built-in replaces it, so the module may
 * re-export the built-ins the game uses.
 */
export function instrumentBank(
  exports: Readonly<Record<string, unknown>>,
  label: string,
): SynthInstrumentBank {
  const custom = new Map<string, SynthInstrumentDefinition>();
  for (const [key, value] of Object.entries(exports)) {
    if (!isInstrumentDefinition(value)) continue;
    const other = custom.get(value.name);
    if (other && other !== value)
      throw new Error(
        `AudioBank: ${label} exports two instruments named "${value.name}" (one of them as "${key}"). Give each definition its own name.`,
      );
    custom.set(value.name, value);
  }
  if (custom.size === 0)
    throw new Error(
      `AudioBank: ${label} exports no instrument definition. Export the result of defineInstrument from @yagejs-addons/synth/render.`,
    );
  const bank: Record<string, SynthInstrumentDefinition> = {};
  for (const definition of Object.values(synthInstruments))
    bank[definition.name] = definition;
  for (const [name, definition] of custom) bank[name] = definition;
  return bank;
}

/** The module's exports come from game code, so their shape is checked. */
function isInstrumentDefinition(
  value: unknown,
): value is SynthInstrumentDefinition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<
    Record<keyof SynthInstrumentDefinition, unknown>
  >;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.pitched === "boolean" &&
    typeof candidate.render === "function" &&
    typeof candidate.sound === "function"
  );
}

/** Every file the module at `path` imports, directly or not, itself first. */
function importedFiles(
  graph: Vite.EnvironmentModuleGraph,
  path: string,
): readonly string[] {
  const seen = new Set<Vite.EnvironmentModuleNode>();
  const files = new Set<string>([path]);
  const visit = (node: Vite.EnvironmentModuleNode): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.file) files.add(node.file);
    for (const imported of node.importedModules) visit(imported);
  };
  for (const node of graph.getModulesByFile(path) ?? []) visit(node);
  return [...files];
}

/** `vite` is an optional peer dependency: only `--instruments` needs it. */
async function importVite(): Promise<typeof Vite> {
  try {
    return await import("vite");
  } catch (error) {
    if (!isMissingPackage(error, "vite")) throw error;
    throw new Error(
      "AudioBank: --instruments imports the module through Vite, and the vite package is not installed. Install vite in the project, or build from a script with buildAudioBank(config, { outDir, instruments }).",
      { cause: error },
    );
  }
}

/** Whether `error` is Node failing to find the package `name` itself. */
export function isMissingPackage(error: unknown, name: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ERR_MODULE_NOT_FOUND" &&
    error.message.includes(`'${name}'`)
  );
}

/**
 * The line of an import error that says what went wrong. A transform failure
 * opens with a heading that ends in a colon, colours its lines and prints a
 * code frame, which Vite also logs; the first line that is not a heading is
 * the cause.
 */
function importFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const lines = text
    // eslint-disable-next-line no-control-regex -- terminal colour codes
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.find((line) => !line.endsWith(":")) ?? lines[0] ?? text;
}
