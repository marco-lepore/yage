/**
 * File plumbing for Yarn projects: path normalisation, `.yarnproject` globs,
 * the project file's lenient JSON, and localisation CSV tables.
 */

/**
 * A path in one canonical form, so keys from `import.meta.glob`
 * (`./dialogue/Intro.yarn`, `/src/dialogue/Intro.yarn`) and paths resolved
 * against a project file compare equal: `\` → `/`, no `.` segments, `..`
 * folded into its parent where there is one.
 */
export function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  return (absolute ? "/" : "") + out.join("/");
}

/** The directory part of a normalised path (`""` for a bare file name). */
export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** A file name without its directory or extension. */
export function stem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Resolve `path` against the directory `dir` (a leading `/` is absolute). */
export function resolvePath(dir: string, path: string): string {
  return normalizePath(
    path.startsWith("/") || dir === "" ? path : `${dir}/${path}`,
  );
}

/**
 * A glob as a case-insensitive whole-path matcher, the way `.yarnproject`
 * `sourceFiles` / `excludeFiles` read: `**` spans directories, `*` and `?`
 * stay inside one, `{a,b}` is either.
 */
export function globMatcher(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:[^/]*/)*";
      } else {
        re += ".*";
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end < 0) {
        re += "\\{";
        continue;
      }
      re += `(?:${glob
        .slice(i + 1, end)
        .split(",")
        .map((alt) => alt.replace(/[.+^$()|[\]\\]/g, "\\$&"))
        .join("|")})`;
      i = end;
    } else {
      re += c.replace(/[.+^$()|[\]\\{}]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, "i");
}

/**
 * Parse the project file's JSON the way Yarn Spinner reads it: `//` and
 * `/* *\/` comments and trailing commas are allowed. Throws a `SyntaxError`
 * on anything else malformed.
 */
export function parseLenientJson(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === "\\") i++;
      }
      out += text.slice(start, i + 1);
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (c === "," && /^\s*[}\]]/.test(text.slice(i + 1))) continue;
    out += c;
  }
  return JSON.parse(out);
}

/**
 * Read a CSV table (RFC 4180: `,`-separated, `"…"` fields may hold commas,
 * newlines, and `""` for a quote). Returns one object per row, keyed by the
 * header row's lower-cased column names.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((f) => f !== ""));
  if (!head) return [];
  const names = head.map((h) => h.trim().toLowerCase());
  return body.map((r) =>
    Object.fromEntries(names.map((name, i) => [name, r[i] ?? ""])),
  );
}
