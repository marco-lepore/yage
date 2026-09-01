import { randomUUID } from "node:crypto";
import type { Plugin } from "vite";
import type { ResolvedEditorConfig } from "../config/index.js";
import { DraftService } from "../draft/index.js";
import { createLevelFileService } from "../files/index.js";
import {
  readDirectDependencies,
  resolveLevelContributions,
} from "./contributions.js";
import {
  EDITOR_TOKEN_META,
  renderEditorHtml,
  renderPlayHtml,
} from "./editorHtml.js";
import { renderEntryModule, renderPlayEntryModule } from "./entryModule.js";
import { createEditorMiddleware } from "./middleware.js";
import { isEditorPage, isPlayPage } from "./pages.js";

/**
 * Module id of the generated entry.
 *
 * Path-shaped rather than `virtual:`, so the page can reference it from a plain
 * `<script type="module">` — a `virtual:` id carries a null byte the HTML would
 * have to spell out.
 */
export const EDITOR_ENTRY_ID = "/@yage-editor/entry.js";

/** Module id of the generated entry the play page loads. */
export const PLAY_ENTRY_ID = "/@yage-editor/play.js";

export interface YageEditorOptions {
  readonly config: ResolvedEditorConfig;
  /** The project token. Injected in tests; a real run gets a fresh one. */
  readonly token?: string | undefined;
  /** The server epoch. Injected in tests; a real run gets a fresh one. */
  readonly epoch?: string | undefined;
}

/**
 * Serves the editor page, generates the module behind it, and mounts the
 * editor's HTTP routes on the dev server.
 *
 * The plugin is where the server's parts are assembled: one file service over
 * the configured root, one draft service over it, and the routes that call
 * them. Nothing here evaluates project code — the generated entry names the
 * project's modules as strings, and the browser is what imports them.
 */
export function yageEditor(options: YageEditorOptions): Plugin {
  const { config } = options;
  const token = options.token ?? randomUUID();
  const html = renderEditorHtml({ entryId: EDITOR_ENTRY_ID });
  const playHtml = renderPlayHtml({ entryId: PLAY_ENTRY_ID });
  let contributions: readonly string[] = [];
  // Read in `configResolved`, before any request reaches the hooks below.
  let base = "/";

  return {
    name: "yage-editor",
    // The entry id is not a real file, so it is claimed before Vite's own
    // resolver reports it missing.
    enforce: "pre",

    /**
     * The project token, on the two pages that need it: the editor, and the
     * play page, which reads the draft through the same routes the editor
     * does.
     *
     * Every other page the dev server serves is left without it, the game
     * page included — a game reads its level file and never speaks to the
     * editor, so there is nothing for it to authenticate.
     */
    transformIndexHtml(_html, ctx) {
      const path = ctx.path.split("?")[0] ?? "/";
      if (!isEditorPage(path, base) && !isPlayPage(path, base)) return;
      return [
        {
          tag: "meta",
          attrs: { name: EDITOR_TOKEN_META, content: token },
          injectTo: "head-prepend",
        },
      ];
    },

    async configResolved(resolved) {
      base = resolved.base;
      const dependencies = await readDirectDependencies(config.root);
      const found = resolveLevelContributions(dependencies);
      contributions = found.specifiers;
      for (const rejection of found.rejections) {
        resolved.logger.warn(
          `[yage-editor] ignoring the level contribution of ` +
            `${rejection.packageName}: ${rejection.reason}`,
        );
      }
    },

    resolveId(id) {
      return id === EDITOR_ENTRY_ID || id === PLAY_ENTRY_ID ? id : null;
    },

    load(id) {
      const entry = {
        modules: config.modules,
        contributions,
        gamePage: config.gamePage,
      };
      if (id === EDITOR_ENTRY_ID) return renderEntryModule(entry);
      if (id === PLAY_ENTRY_ID) return renderPlayEntryModule(entry);
      return null;
    },

    async configureServer(server) {
      const files = await createLevelFileService({
        root: config.root,
        levels: config.levels,
        assets: config.assets,
        publicDir: server.config.publicDir,
      });
      const draft = new DraftService({
        files,
        projectId: config.projectId,
        epoch: options.epoch ?? randomUUID(),
      });

      server.middlewares.use(
        createEditorMiddleware({
          draft,
          files,
          token,
          log: (message) =>
            server.config.logger.warn(`[yage-editor] ${message}`),
        }),
      );

      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "/";
        const page = isEditorPage(url, server.config.base)
          ? html
          : isPlayPage(url, server.config.base)
            ? playHtml
            : undefined;
        if (page === undefined) {
          next();
          return;
        }
        server.transformIndexHtml(req.url ?? "/", page, req.originalUrl).then(
          (page) => {
            res.setHeader("Content-Type", "text/html");
            res.setHeader("Cache-Control", "no-cache");
            res.end(page);
          },
          (error: unknown) => {
            next(error);
          },
        );
      });
    },
  };
}
