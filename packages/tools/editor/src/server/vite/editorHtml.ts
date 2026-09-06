/** The element the editor mounts into. */
export const EDITOR_HOST_ID = "yage-editor";

/** The element the play page renders the running level into. */
export const PLAY_HOST_ID = "yage-play";

/**
 * Meta tag carrying the per-process project token to the browser. The plugin
 * injects it; no page writes it, so one place decides which pages carry it.
 */
export const EDITOR_TOKEN_META = "yage-editor-token";

export interface EditorHtmlOptions {
  /** Module id of the generated entry. */
  readonly entryId: string;
  readonly title?: string | undefined;
}

/**
 * The editor page. It is served from memory: the editor writes nothing into
 * the project to run.
 */
export function renderEditorHtml(options: EditorHtmlOptions): string {
  const title = escapeHtml(options.title ?? "YAGE level editor");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      html, body, #${EDITOR_HOST_ID} { height: 100%; margin: 0; }
      /* The shell's own --editor-bg, so the page does not change colour when it mounts. */
      body { background: #101217; color: #eef0f3; font: 12px/1.5 system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <div id="${EDITOR_HOST_ID}"></div>
    <script type="module" src="${escapeHtml(options.entryId)}"></script>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The play page: the level the editor holds, running live in the project's own
 * harness. Served from memory like the editor's page, and for the same reason.
 *
 * It carries no editor UI. What it is for is watching the level behave, which
 * means the canvas and nothing over it.
 */
export function renderPlayHtml(options: EditorHtmlOptions): string {
  const title = escapeHtml(options.title ?? "YAGE level play");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      html, body { height: 100%; margin: 0; background: #101217; color: #eef0f3; }
      body { font: 12px/1.5 system-ui, sans-serif; }
      #${PLAY_HOST_ID} { height: 100%; }
      #${PLAY_HOST_ID} canvas { display: block; }
      .yage-play-error {
        margin: 0;
        padding: 12px 16px;
        color: #fca5a5;
        font-family: ui-monospace, monospace;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div id="${PLAY_HOST_ID}"></div>
    <script type="module" src="${escapeHtml(options.entryId)}"></script>
  </body>
</html>
`;
}
