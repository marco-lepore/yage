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
      body { margin: 0; padding: 16px; background: #020617; }
    </style>
  </head>
  <body>
    <div id="${LAB_HOST_ID}"></div>
    <script type="module" src="${opts.entryId}"></script>
  </body>
</html>
`;
}
