import { createRoot, type Root } from "react-dom/client";
import type { LayerDef } from "@yagejs/renderer";
import type { EditorDiagnostic } from "../shared/diagnostics/index.js";
import { EditorApiClient } from "./api/index.js";
import { CommandController } from "./commands/index.js";
import { FileCoordinator } from "./files/index.js";
import {
  PreviewCoordinator,
  asHarness,
  connectPreview,
} from "./preview/index.js";
import { ProjectCoordinator } from "./project/index.js";
import { EditorShell } from "./shell/index.js";
import { LayerSets } from "./layers.js";
import { EditorStore, type ViewStorage } from "./store/index.js";

export interface MountEditorOptions {
  /** The element the editor renders into. */
  readonly host: HTMLElement;
  /** The per-process project token the page was served with. */
  readonly token: string;
  /** The project module's default export, validated here. */
  readonly project: unknown;
  /** The harness module's default export, validated here. */
  readonly harness: unknown;
  /** One entry per package that contributes level entities. */
  readonly contributions: readonly unknown[];
  /**
   * One `LayerDef[]` per layers module the config named, once each and in
   * config order. A level's draft snapshot says which one it belongs to.
   */
  readonly layerSets?: readonly (readonly LayerDef[])[] | undefined;
  /** The project's game page URL, when its config named one. */
  readonly gamePage?: string | undefined;
}

export interface EditorHandle {
  /** Stop the engine, release its assets, and unmount the shell. */
  dispose(): Promise<void>;
}

/**
 * Start the editor in a page.
 *
 * This is the composition root: it constructs the client, the store, the
 * coordinators, and the controller, connects them, and renders the shell. It
 * is the only browser module that knows all of them, which is what keeps every
 * other module's dependencies pointing one way.
 *
 * The shell is rendered before the project, the level, and the preview are
 * ready, so a slow or failing start is something the developer can see instead
 * of a blank page. The one step ahead of it is the bootstrap request, which
 * carries the server epoch every later write needs.
 */
export async function mountEditor(
  options: MountEditorOptions,
): Promise<EditorHandle> {
  const api = new EditorApiClient({ token: options.token });
  const bootstrap = await api.bootstrap();
  const store = new EditorStore({
    api,
    epoch: bootstrap.epoch,
    projectId: bootstrap.projectId,
    levels: bootstrap.levels,
    storage: viewStorage(),
  });

  const layers = new LayerSets(options.layerSets ?? []);

  const canvasHost = document.createElement("div");
  canvasHost.style.position = "absolute";
  canvasHost.style.inset = "0";
  const project = new ProjectCoordinator();
  const preview = new PreviewCoordinator({ host: canvasHost, store });
  const commands = new CommandController({
    store,
    preview,
    catalog: () => project.current.catalog,
  });
  const files = new FileCoordinator({
    api,
    store,
    commands,
    epoch: bootstrap.epoch,
    gamePage: options.gamePage,
  });

  const root: Root = createRoot(options.host);
  root.render(
    <EditorShell
      store={store}
      commands={commands}
      files={files}
      preview={preview}
      canvasHost={canvasHost}
      placeables={() => project.placeables}
      inspectable={(typeId) => project.inspectable(typeId)}
      listAssets={() => api.listAssets()}
      levelDirectories={bootstrap.levelDirectories}
      layerChoices={() => layers.choicesFor(store.getState().file?.layerSet)}
      layerSorts={(layer) =>
        layers.sorted(store.getState().file?.layerSet, layer)
      }
    />,
  );

  const disconnect = connectPreview(
    store,
    () => project.current.catalog,
    preview,
    (index) => layers.defsFor(index),
  );

  const built = project.initialize({
    project: options.project,
    contributions: options.contributions,
  });
  // One source, one report: both problems replace the `catalog` diagnostics,
  // so they are collected and published together rather than one hiding the
  // other.
  const problems = [...built.diagnostics];
  if (!built.ok) store.lockWrites("stale-project");

  const harness = asHarness(options.harness);
  if (!harness) {
    problems.push(
      diagnostic(
        "The harness module's default export is not a harness. Export " +
          "defineHarness({ engine, plugins }) from it.",
      ),
    );
    store.lockWrites("stale-project");
  }
  if (problems.length > 0) {
    store.dispatch({
      type: "diagnostics-replaced",
      source: "catalog",
      diagnostics: problems,
    });
  }
  if (harness) await preview.start(harness);

  const first = store.getState().levels[0];
  if (first) await files.openInitialLevel(first.path);

  return {
    async dispose(): Promise<void> {
      disconnect();
      root.unmount();
      await preview.dispose();
    },
  };
}

/**
 * Where the view a level was last edited from is remembered.
 *
 * Reading `localStorage` throws rather than answering in a page whose storage
 * is blocked, so the property access is the check. Without one the editor runs
 * with a view that starts fresh on every reload.
 */
function viewStorage(): ViewStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function diagnostic(message: string): EditorDiagnostic {
  return {
    code: "catalog-invalid",
    severity: "error",
    source: "catalog",
    message,
    revision: 0,
  };
}
