/**
 * Which pages the editor answers with its own HTML, and which paths serve one
 * configured page.
 *
 * A project page the editor quietly shadows is invisible: the Run control opens
 * a second editor and nothing reports it. Three call sites decide that — the
 * middleware that serves the editor's pages, the token injection, and the
 * config check that refuses a `gamePage` naming one — so they read one module.
 */

/**
 * The shell's own pages, without a base. This is the space a `gamePage` is
 * written in and the space Vite reports to `transformIndexHtml`.
 */
export const EDITOR_PAGE_PATHS: readonly string[] = ["/", "/index.html"];

/**
 * The request paths the editor's middleware answers, under `base`.
 *
 * Only paths under the base. A request to the server root reaches the editor
 * through Vite's own redirect to the base, which is what leaves the page's
 * `baseURI` at the base — the editor's run URL is relative and resolves
 * against it.
 *
 * Callers must pass the base Vite resolved (`ResolvedConfig.base`), not the one
 * written in a config file: Vite appends a trailing slash, rewrites `""` and
 * `"./"` to `"/"`, and reduces an absolute URL to its pathname.
 */
export function editorPagePaths(base: string): readonly string[] {
  if (base === "/") return EDITOR_PAGE_PATHS;
  return [base, `${base}index.html`];
}

/** Whether `path` — a request path with no query — is the editor's own page. */
export function isEditorPage(path: string, base: string): boolean {
  return editorPagePaths(base).includes(path);
}

/**
 * The play page, without a base. It runs the level the editor holds, in the
 * project's own harness, so it is the editor's page and not the project's.
 */
export const PLAY_PAGE_PATHS: readonly string[] = ["/play", "/play.html"];

/** The play page's request paths, under `base`. */
export function playPagePaths(base: string): readonly string[] {
  if (base === "/") return PLAY_PAGE_PATHS;
  return PLAY_PAGE_PATHS.map((path) => `${base}${path.slice(1)}`);
}

/** Whether `path` — a request path with no query — is the play page. */
export function isPlayPage(path: string, base: string): boolean {
  return playPagePaths(base).includes(path);
}

/** Every page the editor serves itself, without a base. */
export const OWN_PAGE_PATHS: readonly string[] = [
  ...EDITOR_PAGE_PATHS,
  ...PLAY_PAGE_PATHS,
];

/**
 * The paths one configured page can be requested at.
 *
 * Vite's HTML fallback resolves a page before it is served, so the path a
 * request carries is not always the one that was configured: a directory
 * arrives as its `index.html`, and an extensionless URL arrives as whichever
 * of `<name>.html` and `<name>/index.html` exists. Every form is listed,
 * because a form that never occurs costs nothing and a missing one costs a
 * shadowed page.
 */
export function servedPagePaths(pagePath: string): readonly string[] {
  if (pagePath.endsWith("/")) return [pagePath, `${pagePath}index.html`];
  const lastSegment = pagePath.slice(pagePath.lastIndexOf("/") + 1);
  if (!lastSegment.includes(".")) {
    return [pagePath, `${pagePath}.html`, `${pagePath}/index.html`];
  }
  return [pagePath];
}

/**
 * Whether a configured page would be shadowed by one of the editor's own.
 *
 * Every form the request could arrive in is checked, not just the one that
 * was written: a `gamePage` of `/play` is reachable as `/play.html`, which is
 * the play page, and the editor's middleware answers it first.
 */
export function shadowsOwnPage(pagePath: string): boolean {
  return servedPagePaths(pagePath).some((path) =>
    OWN_PAGE_PATHS.includes(path),
  );
}
