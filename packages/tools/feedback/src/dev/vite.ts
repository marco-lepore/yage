import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { createFeedbackApplication } from "../server/http/application.js";
import { normalizeBasePath } from "../shared/endpoint.js";

export interface YageFeedbackOptions {
  /** Relative to the Vite root. One running server may own this directory. */
  directory?: string;
  /** Relative to Vite's base. Defaults to /__yage/feedback/. */
  basePath?: string;
}
/** Mounts local feedback during development; production builds contain no routes. */
export function yageFeedback(options: YageFeedbackOptions = {}): Plugin {
  let config: ResolvedConfig;
  let basePath: string;
  let application: ReturnType<typeof createFeedbackApplication> | undefined;
  return {
    name: "yage-feedback",
    apply: "serve",
    configResolved(value) {
      config = value;
      if (config.server.https)
        throw new Error("YAGE feedback requires a local HTTP dev server.");
      if (normalizeBasePath(options.basePath ?? "/__yage/feedback/") === "/")
        throw new Error(
          "YAGE feedback basePath must name a subpath so the game remains accessible.",
        );
      basePath =
        normalizeBasePath(config.base) +
        normalizeBasePath(options.basePath ?? "/__yage/feedback/").slice(1);
    },
    configureServer(server) {
      application = createFeedbackApplication({
        directory: path.resolve(
          config.root,
          options.directory ?? ".yage/feedback",
        ),
        project: config.root,
        basePath: basePath + "api/",
        galleryPath: basePath,
      });
      const current = application;
      server.httpServer?.on("error", (failure: NodeJS.ErrnoException) => {
        if (failure.code === "EADDRINUSE" && !config.server.strictPort) return;
        void current
          .close()
          .catch((error: unknown) => server.config.logger.error(String(error)));
      });
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost")
          .pathname;
        if (pathname === basePath.slice(0, -1) || pathname.startsWith(basePath))
          current.handle(request, response);
        else next();
      });
      server.config.logger.info(`YAGE feedback gallery: ${basePath}`);
    },
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { name: "yage-feedback-server", content: basePath + "api/" },
          injectTo: "head",
        },
      ];
    },
    async closeBundle() {
      await application?.close();
      application = undefined;
    },
  };
}
