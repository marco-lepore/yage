import type { ResolvedEditorModules } from "../config/index.js";
import {
  EDITOR_HOST_ID,
  EDITOR_TOKEN_META,
  PLAY_HOST_ID,
} from "./editorHtml.js";

export interface EntryModuleOptions {
  /** Root-absolute URLs of the project's modules. */
  readonly modules: ResolvedEditorModules;
  /** Package contribution specifiers, already validated. */
  readonly contributions: readonly string[];
  /** The project's game page URL, when it named one. */
  readonly gamePage?: string | undefined;
}

/**
 * Source of the module the editor page loads.
 *
 * It is generated because Vite needs literal import specifiers at transform
 * time, and which modules to import is known only after the CLI has read the
 * project's config. This is the one module that names project code, and it
 * holds no editing logic: it imports, mounts, and reports a failure.
 *
 * Every path is emitted through `JSON.stringify`, so a path containing a quote
 * or a newline becomes an escaped string literal rather than executable text.
 * Package specifiers are validated before they arrive here; the escaping is the
 * second of the two checks.
 */
export function renderEntryModule(options: EntryModuleOptions): string {
  const { modules, contributions } = options;
  const imports = [
    `import project from ${JSON.stringify(modules.project)};`,
    `import harness from ${JSON.stringify(modules.harness)};`,
  ];
  contributions.forEach((specifier, index) => {
    imports.push(
      `import contribution${index} from ${JSON.stringify(specifier)};`,
    );
  });
  imports.push(`import { mountEditor } from "@yagejs-tools/editor/browser";`);

  const contributionList = contributions
    .map((_specifier, index) => `contribution${index}`)
    .join(", ");

  return `${imports.join("\n")}

const host = document.getElementById(${JSON.stringify(EDITOR_HOST_ID)});
const token =
  document
    .querySelector(${JSON.stringify(`meta[name="${EDITOR_TOKEN_META}"]`)})
    ?.getAttribute("content") ?? "";

try {
  await mountEditor({
    host,
    token,
    project,
    harness,
    gamePage: ${options.gamePage === undefined ? "undefined" : JSON.stringify(options.gamePage)},
    contributions: [${contributionList}],
  });
} catch (error) {
  console.error("[yage-editor]", error);
  const line = document.createElement("pre");
  line.style.color = "#fca5a5";
  line.textContent = \`yage-editor failed to start: \${error?.message ?? error}\`;
  document.body.append(line);
}
`;
}

/**
 * Source of the module the play page loads.
 *
 * The same project modules the editor entry names, mounted into a page that
 * runs the level rather than editing it. The two are generated separately
 * because they import different things from the editor package, and a shared
 * entry would pull the whole shell into a page that draws none of it.
 */
export function renderPlayEntryModule(options: EntryModuleOptions): string {
  const { modules, contributions } = options;
  const imports = [
    `import project from ${JSON.stringify(modules.project)};`,
    `import harness from ${JSON.stringify(modules.harness)};`,
  ];
  contributions.forEach((specifier, index) => {
    imports.push(
      `import contribution${index} from ${JSON.stringify(specifier)};`,
    );
  });
  imports.push(`import { mountPlay } from "@yagejs-tools/editor/browser";`);

  const contributionList = contributions
    .map((_specifier, index) => `contribution${index}`)
    .join(", ");

  return `${imports.join("\n")}

const host = document.getElementById(${JSON.stringify(PLAY_HOST_ID)});
const token =
  document
    .querySelector(${JSON.stringify(`meta[name="${EDITOR_TOKEN_META}"]`)})
    ?.getAttribute("content") ?? "";

try {
  await mountPlay({
    host,
    token,
    project,
    harness,
    contributions: [${contributionList}],
  });
} catch (error) {
  console.error("[yage-editor]", error);
  const line = document.createElement("pre");
  line.className = "yage-play-error";
  line.textContent = \`The level could not be played: \${error?.message ?? error}\`;
  document.body.append(line);
}
`;
}
