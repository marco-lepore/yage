/** The element the lab mounts into. */
export const LAB_HOST_ID = "yage-lab";

export interface LabHtmlOptions {
  /** Module id of the generated entry, written into the script tag. */
  entryId: string;
  title?: string | undefined;
}

/**
 * The page the lab runs in. The dev server serves it from middleware; a build
 * writes it to disk, because Rollup needs a real HTML input file.
 *
 * It carries no chrome of its own — the panel injects its own styles and builds
 * everything inside the host element.
 */
export function renderLabHtml(opts: LabHtmlOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${opts.title ?? "YAGE Lab"}</title>
    <style>
      :root { color-scheme: dark; }
      /* The page itself never scrolls: the panel's columns do, so the scenario
         list cannot move the canvas. The host takes the space left over rather
         than all of it, so a boot failure appended after it is on screen. */
      html, body { height: 100%; }
      body { margin: 0; padding: 16px; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; background: #020617; }
      #${LAB_HOST_ID} { flex: 1 1 auto; min-height: 0; }
    </style>
  </head>
  <body>
    <div id="${LAB_HOST_ID}"></div>
    <script type="module" src="${opts.entryId}"></script>
  </body>
</html>
`;
}
