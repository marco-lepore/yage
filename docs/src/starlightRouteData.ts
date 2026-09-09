import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { LLMS_INDEX, resolveLlmDoc } from "../scripts/llm-docs.mjs";

// Injected by astro.config.mjs. `copy-llms.mjs` fills public/llms/ before the
// Astro build; a page only advertises a Markdown counterpart that is served.
declare const __DOCS_PUBLIC_DIR__: string;
const publicDir = __DOCS_PUBLIC_DIR__;

/**
 * Adds agent discovery links to every page's `<head>`:
 * `rel="describedby"` pointing at the index, and `rel="alternate"` with the
 * page's Markdown counterpart when one exists.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const { head, id } = context.locals.starlightRoute;
  head.push({ tag: "link", attrs: { rel: "describedby", href: LLMS_INDEX } });
  const markdown = resolveLlmDoc(id);
  if (markdown && existsSync(join(publicDir, markdown))) {
    head.push({
      tag: "link",
      attrs: { rel: "alternate", type: "text/markdown", href: markdown },
    });
  }
});
