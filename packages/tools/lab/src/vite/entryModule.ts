import { LAB_HOST_ID } from "./labHtml.js";

export interface EntryModuleOptions {
  /** Root-absolute URL of the project's harness file. */
  harness: string;
  /** Root-absolute glob patterns. */
  patterns: readonly string[];
  /** The directory scenario ids are derived against. */
  root: string;
}

/**
 * Source of the module the page loads.
 *
 * It is generated rather than shipped because `import.meta.glob` needs a
 * literal pattern Vite can read at transform time, and the pattern is only
 * known once the CLI has read the project's configuration.
 */
export function renderEntryModule(opts: EntryModuleOptions): string {
  return `import harness from ${JSON.stringify(opts.harness)};
import { mount } from "@yagejs-tools/lab/runner";

const modules = import.meta.glob(${JSON.stringify(opts.patterns)}, { eager: true });
const host = document.getElementById(${JSON.stringify(LAB_HOST_ID)});

mount({ harness, modules, root: ${JSON.stringify(opts.root)}, host }).catch((error) => {
  console.error("[yage-lab]", error);
  const line = document.createElement("pre");
  line.style.color = "#fca5a5";
  line.textContent = \`yage-lab failed to start: \${error?.message ?? error}\`;
  document.body.append(line);
});
`;
}
