/**
 * The `scripts` entry `init` adds to a project's package.json.
 *
 * The manifest is edited as text rather than parsed and re-serialized: a
 * project's own key order, indentation and trailing newline are its own, and a
 * round trip through `JSON.stringify` would rewrite all three.
 */

/** The script name the editor claims. */
export const SCRIPT_NAME = "editor";

/** The `scripts.editor` a manifest already declares, if any. */
export function readEditorScript(source: string): string | undefined {
  const parsed: unknown = JSON.parse(source);
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const scripts = (parsed as Record<string, unknown>)["scripts"];
  if (typeof scripts !== "object" || scripts === null) return undefined;
  const value = (scripts as Record<string, unknown>)[SCRIPT_NAME];
  return typeof value === "string" ? value : undefined;
}

/**
 * `source` with `scripts.editor` set to `command` — replaced where the
 * manifest already declares one, and otherwise added as the first entry of
 * `scripts`.
 *
 * First rather than last because the last entry is the one whose comma the
 * insertion would have to get right; nothing already in the file moves
 * relative to anything else either way.
 *
 * Throws when the result is not a manifest declaring the script, which is the
 * one check that catches every way the text surgery could go wrong.
 */
export function withEditorScript(source: string, command: string): string {
  const entry = `${JSON.stringify(SCRIPT_NAME)}: ${JSON.stringify(command)}`;
  const unit = detectIndent(source);
  const existing = readEditorScript(source);
  const block = findScripts(source);
  const text =
    existing !== undefined
      ? replace(source, existing, command)
      : block === undefined
        ? withScriptsBlock(source, entry, unit)
        : insert(source, block, entry, unit);

  let written: string | undefined;
  try {
    written = readEditorScript(text);
  } catch {
    written = undefined;
  }
  if (written !== command) {
    throw new Error(
      `Could not add the "${SCRIPT_NAME}" script to package.json. Add ` +
        `${entry} to its "scripts" by hand, then run this again — it picks ` +
        `up from a script that is already declared.`,
    );
  }
  return text;
}

/** The declared value swapped for a new one, leaving the key where it is. */
function replace(source: string, existing: string, command: string): string {
  const pattern = new RegExp(
    `("${SCRIPT_NAME}"[ \\t]*:[ \\t]*)${escaped(JSON.stringify(existing))}`,
  );
  return source.replace(pattern, `$1${JSON.stringify(command)}`);
}

/** `text` as a pattern matching itself. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ScriptsBlock {
  /** Index just after the opening brace. */
  readonly open: number;
  /** Index of the closing brace. */
  readonly close: number;
  /** Indentation of the `"scripts"` key itself. */
  readonly keyIndent: string;
}

/**
 * The `scripts` object of the manifest itself.
 *
 * The manifest is walked rather than matched line by line, so a single-line
 * file and an object whose brace sits on the next line both resolve, and a
 * `scripts` key nested in some other object is never taken for this one.
 */
function findScripts(source: string): ScriptsBlock | undefined {
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      const end = endOfString(source, i);
      if (end === undefined) return undefined;
      if (depth === 1 && source.slice(i + 1, end) === "scripts") {
        const brace = objectValue(source, end + 1);
        if (brace !== undefined) {
          const close = closingBrace(source, brace + 1);
          if (close === undefined) return undefined;
          return {
            open: brace + 1,
            close,
            keyIndent: indentBefore(source, i),
          };
        }
      }
      i = end;
    } else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
  }
  return undefined;
}

/** The quote closing the string that opens at `from`. */
function endOfString(source: string, from: number): number | undefined {
  for (let i = from + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") i++;
    else if (char === '"') return i;
  }
  return undefined;
}

/** The `{` opening the object a key at `from` is given, if it is given one. */
function objectValue(source: string, from: number): number | undefined {
  let i = skipSpace(source, from);
  if (source[i] !== ":") return undefined;
  i = skipSpace(source, i + 1);
  return source[i] === "{" ? i : undefined;
}

function skipSpace(source: string, from: number): number {
  let i = from;
  while (i < source.length && /\s/.test(source[i] as string)) i++;
  return i;
}

/** The indentation of the line `index` sits on, empty when it shares one. */
function indentBefore(source: string, index: number): string {
  const text = source.slice(source.lastIndexOf("\n", index) + 1, index);
  return /^[ \t]*$/.test(text) ? text : "";
}

/** The brace closing the object whose contents start at `from`. */
function closingBrace(source: string, from: number): number | undefined {
  let depth = 1;
  let inString = false;
  for (let i = from; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i;
  }
  return undefined;
}

function insert(
  source: string,
  block: ScriptsBlock,
  entry: string,
  unit: string,
): string {
  const nl = detectNewline(source);
  const contents = source.slice(block.open, block.close);
  const entryIndent =
    /\n([ \t]*)"/.exec(contents)?.[1] ?? `${block.keyIndent}${unit}`;
  // An empty `scripts` has no following entry for the comma to belong to.
  if (contents.trim() === "") {
    return (
      source.slice(0, block.open) +
      `${nl}${entryIndent}${entry}${nl}${block.keyIndent}` +
      source.slice(block.close)
    );
  }
  return (
    source.slice(0, block.open) +
    `${nl}${entryIndent}${entry},` +
    source.slice(block.open)
  );
}

/** A manifest with no `scripts` gets one, first among its own keys. */
function withScriptsBlock(source: string, entry: string, unit: string): string {
  const open = source.indexOf("{");
  if (open === -1) throw new Error("package.json is not a JSON object.");
  const nl = detectNewline(source);
  const block = `${nl}${unit}"scripts": {${nl}${unit}${unit}${entry}${nl}${unit}},`;
  return source.slice(0, open + 1) + block + source.slice(open + 1);
}

/** The indentation the manifest already uses, from its first indented key. */
function detectIndent(source: string): string {
  return /\n([ \t]+)"/.exec(source)?.[1] ?? "  ";
}

/** The line ending the manifest already uses, from the first one in it. */
function detectNewline(source: string): string {
  return /\r\n|\n|\r/.exec(source)?.[0] ?? "\n";
}
