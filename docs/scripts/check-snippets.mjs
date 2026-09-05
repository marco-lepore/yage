import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const languages = new Set(["ts", "typescript", "tsx"]);
const wrappers = new Set([
  "component",
  "scene-enter",
  "async",
  "expression",
  "type",
  "object-member",
]);
const hosts = {
  engine: ["Engine", "engine"],
  scene: ["Scene", "scene"],
  entity: ["Entity", "entity"],
  context: ["EngineContext", "context"],
  inspector: ["Inspector", "inspector"],
};
const contexts = new Set([
  ...Object.keys(hosts),
  ...wrappers,
  "browser",
  "playwright",
  "vitest",
]);
const keys = new Set(["group", "file", "context", "check", "reason"]);

function walk(directory, accept) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        ["node_modules", "dist", "public", "api", ".git"].includes(entry.name)
      )
        return [];
      return walk(path, accept);
    }
    return accept(path) ? [path] : [];
  });
}

export function packageDirectories(root) {
  const base = join(root, "packages");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const path = join(base, entry.name);
      if (["addons", "tools"].includes(entry.name)) {
        return readdirSync(path)
          .map((name) => join(path, name))
          .filter((dir) => existsSync(join(dir, "package.json")));
      }
      return existsSync(join(path, "package.json")) ? [path] : [];
    })
    .sort();
}

export function discoverCorpus(root = repoRoot) {
  const result = [];
  for (const [path, category] of [
    ["docs/llms", "llm"],
    ["docs/src/content/docs", "human"],
  ]) {
    if (!existsSync(join(root, path)))
      throw new Error(`Missing primary documentation root: ${path}`);
    result.push(
      ...walk(join(root, path), (file) => /\.mdx?$/.test(file)).map((file) => ({
        file,
        category,
      })),
    );
  }
  for (const directory of packageDirectories(root)) {
    const readme = join(directory, "README.md");
    if (existsSync(readme)) result.push({ file: readme, category: "readme" });
    if (/\/packages\/(addons|tools)\//.test(directory)) {
      result.push(
        ...walk(join(directory, "docs/llms"), (file) =>
          file.endsWith(".md"),
        ).map((file) => ({ file, category: "package-llm" })),
      );
    }
  }
  for (const path of [
    "docs/ARCHITECTURE.md",
    "docs/AGENT_GUIDE.md",
    "AGENTS.md",
    "packages/addons/AGENTS.md",
  ]) {
    if (!existsSync(join(root, path)))
      throw new Error(`Missing documentation input: ${path}`);
    result.push({ file: join(root, path), category: "architecture" });
  }
  return result.sort((a, b) => a.file.localeCompare(b.file));
}

function esmTypes(value) {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.map(esmTypes).find(Boolean);
  if (typeof value.types === "string") return value.types;
  if (value.import) {
    const found = esmTypes(value.import);
    if (found) return found;
  }
  for (const [key, condition] of Object.entries(value)) {
    if (key === "require" || key === "import") continue;
    const found = esmTypes(condition);
    if (found) return found;
  }
  return undefined;
}

export function declarationEntries(root = repoRoot) {
  const entries = {};
  for (const directory of packageDirectories(root)) {
    const manifest = JSON.parse(
      readFileSync(join(directory, "package.json"), "utf8"),
    );
    if (!manifest.exports) continue;
    const exports = Object.keys(manifest.exports).some((key) =>
      key.startsWith("."),
    )
      ? manifest.exports
      : { ".": manifest.exports };
    for (const [subpath, conditions] of Object.entries(exports)) {
      const target = esmTypes(conditions);
      if (!target) continue;
      if (subpath.includes("*") || target.includes("*"))
        throw new Error(
          `Unsupported wildcard declaration export: ${manifest.name}${subpath}`,
        );
      const path = resolve(directory, target);
      const name = manifest.name + (subpath === "." ? "" : subpath.slice(1));
      if (!existsSync(path))
        throw new Error(
          `Missing built declaration for ${name}: ${relative(root, path)}. Run npx turbo build.`,
        );
      entries[name] = path;
    }
  }
  if (!Object.keys(entries).length)
    throw new Error("No built package declaration entries found.");
  return entries;
}

export function parseMetadata(meta = "") {
  meta ??= "";
  const result = {};
  const tokens = [];
  let token = "";
  let quote;
  for (let index = 0; index < meta.length; index++) {
    const character = meta[index];
    if (quote) {
      token += character;
      if (character === "\\" && index + 1 < meta.length) token += meta[++index];
      else if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
      token += character;
    } else if (/\s/.test(character)) {
      if (token) tokens.push(token);
      token = "";
    } else token += character;
  }
  if (quote) throw new Error("Unterminated quoted fence metadata.");
  if (token) tokens.push(token);
  for (const token of tokens) {
    if (!token.startsWith("yage-")) continue;
    const match = /^(yage-[\w-]+)=(.+)$/.exec(token);
    if (!match) throw new Error(`Malformed checker metadata: ${token}`);
    const key = match[1].slice(5);
    if (!keys.has(key))
      throw new Error(`Unknown checker metadata: ${match[1]}`);
    if (Object.hasOwn(result, key))
      throw new Error(`Duplicate checker metadata: ${match[1]}`);
    if (!/^(?:"[^"]*"|'[^']*'|[^\s"']+)$/.test(match[2]))
      throw new Error(`Malformed value for ${match[1]}`);
    if (
      !match[2] ||
      (/^["']/.test(match[2]) && match[2].at(-1) !== match[2][0])
    )
      throw new Error(`Expected a value for ${match[1]}`);
    result[key] = /^["']/.test(match[2]) ? match[2].slice(1, -1) : match[2];
    if (!result[key])
      throw new Error(`Expected a nonempty value for ${match[1]}`);
  }
  if (
    result.file &&
    (!result.group ||
      isAbsolute(result.file) ||
      result.file.includes("\\") ||
      result.file.split("/").includes("..") ||
      !/\.(ts|tsx)$/.test(result.file))
  ) {
    throw new Error(
      "yage-file requires a group and a relative .ts/.tsx path without '..'.",
    );
  }
  if (result.group && !/^[a-zA-Z0-9_-]+$/.test(result.group))
    throw new Error(
      "yage-group must contain only letters, digits, '_' or '-'.",
    );
  result.contexts = result.context ? result.context.split(",") : [];
  if (new Set(result.contexts).size !== result.contexts.length)
    throw new Error("Duplicate context.");
  for (const context of result.contexts)
    if (!contexts.has(context)) throw new Error(`Unknown context: ${context}`);
  if (result.contexts.filter((context) => wrappers.has(context)).length > 1)
    throw new Error("Only one structural context is allowed.");
  result.check ??= "type";
  if (!["type", "syntax"].includes(result.check))
    throw new Error(`Unknown check mode: ${result.check}`);
  if (
    result.check === "syntax" &&
    (!result.reason || result.reason.trim().length < 20)
  )
    throw new Error(
      "Syntax-only examples require a substantive yage-reason (at least 20 characters).",
    );
  if (result.reason && result.check !== "syntax")
    throw new Error("yage-reason is only valid with yage-check=syntax.");
  return result;
}

export function extractSnippets(text, file, category = "fixture") {
  const parser = unified().use(remarkParse);
  if (file.endsWith(".mdx")) parser.use(remarkMdx);
  const tree = parser.parse(text);
  const snippets = [];
  function visit(node) {
    if (node.type === "code" && languages.has(node.lang?.toLowerCase())) {
      const snippet = {
        id: `${file}#${snippets.length + 1}`,
        file,
        category,
        line: node.position.start.line,
        language: node.lang.toLowerCase(),
        code: node.value,
        diagnostics: [],
        expected: [],
        status: "checked",
      };
      try {
        snippet.metadata = parseMetadata(node.meta);
      } catch (error) {
        snippet.metadata = { contexts: [], check: "type" };
        snippet.diagnostics.push({
          code: "directive",
          line: snippet.line,
          column: 1,
          message: error.message,
        });
      }
      snippet.group =
        snippet.metadata.group ?? `snippet-${snippets.length + 1}`;
      const source = ts.createSourceFile(
        snippet.language === "tsx" ? "snippet.tsx" : "snippet.ts",
        snippet.code,
        ts.ScriptTarget.Latest,
        true,
      );
      const suppressions = (source.commentDirectives ?? []).map(
        (directive) => directive.range,
      );
      if (source.checkJsDirective?.enabled === false)
        suppressions.push(source.checkJsDirective);
      for (const suppression of suppressions)
        snippet.diagnostics.push({
          code: "directive",
          line:
            snippet.line +
            source.getLineAndCharacterOfPosition(suppression.pos).line +
            1,
          column: 1,
          message:
            "Use exact yage-expect-error codes instead of TypeScript suppression directives.",
        });
      const commentLines = new Set();
      const inspectComments = (node) => {
        for (const range of [
          ...(ts.getLeadingCommentRanges(snippet.code, node.pos) ?? []),
          ...(ts.getTrailingCommentRanges(snippet.code, node.end) ?? []),
        ]) {
          if (
            snippet.code
              .slice(range.pos, range.end)
              .includes("yage-expect-error")
          )
            commentLines.add(
              source.getLineAndCharacterOfPosition(range.pos).line,
            );
        }
        ts.forEachChild(node, inspectComments);
      };
      inspectComments(source);
      snippet.code.split("\n").forEach((line, index) => {
        if (!commentLines.has(index)) return;
        const match = /^\s*\/\/ yage-expect-error (TS\d+(?:,TS\d+)*)\s*$/.exec(
          line,
        );
        if (!match)
          snippet.diagnostics.push({
            code: "directive",
            line: snippet.line + index + 1,
            column: 1,
            message:
              "Expected '// yage-expect-error TS1234,TS5678' on its own line.",
          });
        else {
          const codes = match[1]
            .split(",")
            .map((code) => Number(code.slice(2)));
          if (new Set(codes).size !== codes.length)
            snippet.diagnostics.push({
              code: "directive",
              line: snippet.line + index + 1,
              column: 1,
              message: "Duplicate expected diagnostic code.",
            });
          snippet.expected.push(
            ...codes.map((code) => ({
              code,
              line: snippet.line + index + 2,
              matched: false,
            })),
          );
        }
      });
      if (snippet.metadata.check === "syntax" && snippet.expected.length)
        snippet.diagnostics.push({
          code: "directive",
          line: snippet.line,
          column: 1,
          message: "Syntax-only examples cannot declare expected type errors.",
        });
      snippets.push(snippet);
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  return snippets;
}

function buildVirtualSource(parts, path) {
  const first = parts[0];
  const selected = first.metadata.contexts;
  const supplied = new Set(
    selected.flatMap((context) =>
      hosts[context]
        ? [hosts[context][1]]
        : context === "browser"
          ? ["window"]
          : context === "playwright"
            ? ["test", "expect", "page"]
            : context === "vitest"
              ? [
                  "test",
                  "it",
                  "expect",
                  "describe",
                  "vi",
                  "beforeEach",
                  "afterEach",
                ]
              : [],
    ),
  );
  function bindingNames(name) {
    if (ts.isIdentifier(name)) return [name.text];
    return name.elements.flatMap((element) =>
      ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
    );
  }
  for (const part of parts) {
    const parsed = ts.createSourceFile(
      part.language === "tsx" ? "snippet.tsx" : "snippet.ts",
      part.code,
      ts.ScriptTarget.Latest,
      true,
    );
    const names = parsed.statements.flatMap((statement) => {
      if (ts.isVariableStatement(statement))
        return statement.declarationList.declarations.flatMap((declaration) =>
          bindingNames(declaration.name),
        );
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (!clause) return [];
        const bindings = clause.namedBindings;
        return [
          ...(clause.name ? [clause.name.text] : []),
          ...(bindings
            ? ts.isNamespaceImport(bindings)
              ? [bindings.name.text]
              : bindings.elements.map((element) => element.name.text)
            : []),
        ];
      }
      return statement.name && ts.isIdentifier(statement.name)
        ? [statement.name.text]
        : [];
    });
    for (const name of names)
      if (supplied.has(name))
        part.diagnostics.push({
          code: "directive",
          line: part.line,
          column: 1,
          message: `Context binding '${name}' conflicts with an authored declaration.`,
        });
  }
  const lines = [];
  const mapping = [];
  const add = (
    text,
    snippet = first,
    startLine = snippet.line,
    authored = false,
  ) => {
    text.split("\n").forEach((line, index) => {
      lines.push(line);
      mapping.push({
        snippet,
        line: startLine + (authored ? index : 0),
        generated: !authored,
      });
    });
  };
  const authored = parts.map((part) => part.code).join("\n");
  let prefix = "__yageSnippet";
  while (authored.includes(prefix)) prefix += "_";
  for (const part of parts)
    part.code.split("\n").forEach((line, index) => {
      if (/^\s*\/\/\/\s*<reference\s/.test(line))
        add(line, part, part.line + index + 1, true);
    });
  add("export {};");
  for (const context of selected) {
    if (hosts[context]) {
      const [type, name] = hosts[context];
      add(
        `import type { ${type} as ${prefix}${type} } from "@yagejs/core";\ndeclare const ${name}: ${prefix}${type};`,
      );
    }
    if (context === "browser")
      add(
        `import type { Inspector as ${prefix}Inspector, Logger as ${prefix}Logger } from "@yagejs/core";\ndeclare const window: Window & { __yage__: { inspector: ${prefix}Inspector; logger: ${prefix}Logger; ready: Promise<void> } };`,
      );
    if (context === "playwright")
      add(
        `import { test, expect } from "@playwright/test";\nimport type { Page as ${prefix}Page } from "@playwright/test";\ndeclare const page: ${prefix}Page;`,
      );
    if (context === "vitest")
      add(
        'import { test, it, expect, describe, vi, beforeEach, afterEach } from "vitest";',
      );
  }
  const wrapper = selected.find((context) => wrappers.has(context));
  const frames = {
    component: [
      `import { Component as ${prefix}Base } from "@yagejs/core";\nclass ${prefix} extends ${prefix}Base {\nupdate(dt: number) {`,
      "}\n}",
    ],
    "scene-enter": [
      `import { Scene as ${prefix}Base } from "@yagejs/core";\nclass ${prefix} extends ${prefix}Base {\nreadonly name = "snippet";\nasync onEnter() {`,
      "}\n}",
    ],
    async: [`async function ${prefix}() {`, "}"],
    expression: [`const ${prefix} = (`, ");"],
    type: [`type ${prefix} =`, ";"],
    "object-member": [`interface ${prefix} {`, "}"],
  };
  const hoisted = new Map();
  if (wrapper) {
    for (const part of parts) {
      const source = ts.createSourceFile(
        part.language === "tsx" ? "snippet.tsx" : "snippet.ts",
        part.code,
        ts.ScriptTarget.Latest,
        true,
      );
      const body = part.code.split("");
      for (const statement of source.statements) {
        if (
          !ts.isImportDeclaration(statement) &&
          !ts.isImportEqualsDeclaration(statement)
        )
          continue;
        const start = source.getLineAndCharacterOfPosition(
          statement.getStart(source),
        ).line;
        add(
          part.code.slice(statement.getStart(source), statement.end),
          part,
          part.line + start + 1,
          true,
        );
        for (
          let offset = statement.getStart(source);
          offset < statement.end;
          offset++
        )
          if (body[offset] !== "\n") body[offset] = " ";
      }
      hoisted.set(part, body.join(""));
    }
  }
  if (wrapper) add(frames[wrapper][0]);
  for (const part of parts) {
    (hoisted.get(part) ?? part.code).split("\n").forEach((line, index) => {
      if (!/^\s*\/\/\/\s*<reference\s/.test(line))
        add(line, part, part.line + index + 1, true);
    });
  }
  if (wrapper) add(frames[wrapper][1]);
  return {
    path,
    text: lines.join("\n"),
    mapping,
    parts,
    group: `${first.file}#${first.metadata.group ? "group" : "isolated"}-${first.group}`,
  };
}

export function checkDocuments(
  documents,
  { root = repoRoot, entries = declarationEntries(root) } = {},
) {
  const snippets = [];
  const errors = [];
  for (const document of documents) {
    try {
      snippets.push(
        ...extractSnippets(document.text, document.file, document.category),
      );
    } catch (error) {
      errors.push({
        file: document.file,
        line: error.line ?? 1,
        code: "markdown",
        message: error.message,
      });
    }
  }
  const files = new Map();
  snippets.forEach((snippet) => {
    if (snippet.diagnostics.length) return;
    const pageIndex = documents.findIndex(
      (document) => document.file === snippet.file,
    );
    const filename =
      snippet.metadata.file ??
      (snippet.language === "tsx" ? "index.tsx" : "index.ts");
    const path = join(
      root,
      ".doc-snippets",
      String(pageIndex),
      `${snippet.metadata.group ? "group" : "isolated"}-${snippet.group}`,
      filename,
    );
    const parts = files.get(path) ?? [];
    if (
      parts.length &&
      (parts[0].metadata.check !== snippet.metadata.check ||
        parts[0].metadata.contexts.join(",") !==
          snippet.metadata.contexts.join(","))
    ) {
      snippet.diagnostics.push({
        code: "directive",
        line: snippet.line,
        column: 1,
        message: "Conflicting check modes or contexts for one virtual file.",
      });
    } else {
      parts.push(snippet);
      files.set(path, parts);
    }
  });
  const virtual = new Map(
    [...files].map(([path, parts]) => [path, buildVirtualSource(parts, path)]),
  );
  const options = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noUncheckedSideEffectImports: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    jsx: ts.JsxEmit.ReactJSX,
    experimentalDecorators: true,
    skipLibCheck: true,
    noEmit: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    types: [],
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    paths: Object.fromEntries(
      Object.entries(entries).map(([name, path]) => [name, [path]]),
    ),
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists.bind(host);
  const isPackageSource = (path) =>
    path.startsWith(join(root, "packages") + "/") &&
    /\.[cm]?tsx?$/.test(path) &&
    !/\.d\.[cm]?ts$/.test(path);
  let activeFiles = new Set();
  host.readFile = (path) =>
    virtual.has(path)
      ? activeFiles.has(path)
        ? virtual.get(path).text
        : undefined
      : readFile(path);
  host.fileExists = (path) =>
    virtual.has(path)
      ? activeFiles.has(path)
      : !isPackageSource(path) && fileExists(path);
  host.directoryExists = (path) =>
    [...activeFiles].some((file) => file.startsWith(path + "/")) ||
    directoryExists(path);
  const parsedFiles = new Map();
  host.getSourceFile = (path, version) => {
    if (isPackageSource(path) || (virtual.has(path) && !activeFiles.has(path)))
      return undefined;
    if (parsedFiles.has(path)) return parsedFiles.get(path);
    const source = host.readFile(path);
    if (source === undefined) return undefined;
    const parsed = ts.createSourceFile(path, source, version, true);
    parsedFiles.set(path, parsed);
    return parsed;
  };
  host.resolveModuleNames = (names, containingFile) =>
    names.map((name) => {
      if (
        virtual.has(containingFile) &&
        (name.startsWith(".") || isAbsolute(name))
      ) {
        const target = resolve(dirname(containingFile), name);
        const candidate = target.replace(/\.(?:js|jsx)$/, "");
        const path = [
          target,
          candidate + ".ts",
          candidate + ".tsx",
          join(target, "index.ts"),
          join(target, "index.tsx"),
        ].find((path) => activeFiles.has(path));
        return path
          ? {
              resolvedFileName: path,
              extension: path.endsWith(".tsx")
                ? ts.Extension.Tsx
                : ts.Extension.Ts,
            }
          : undefined;
      }
      return ts.resolveModuleName(name, containingFile, options, host)
        .resolvedModule;
    });
  function record(diagnostic) {
    const source = diagnostic.file && virtual.get(diagnostic.file.fileName);
    if (!source) {
      errors.push({
        file: "<compiler>",
        line: 1,
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      });
      return;
    }
    const position = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start ?? 0,
    );
    const mapped = source.mapping[position.line] ?? source.mapping.at(-1);
    const snippet = mapped.snippet;
    const expected =
      !mapped.generated &&
      snippet.expected.find(
        (expectation) =>
          expectation.code === diagnostic.code &&
          expectation.line === mapped.line,
      );
    if (expected) {
      expected.matched = true;
      return;
    }
    snippet.diagnostics.push({
      code: diagnostic.code,
      line: mapped.line,
      column: position.character + 1,
      generated: mapped.generated,
      message:
        (mapped.generated ? "Context directive: " : "") +
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    });
  }
  const groups = new Map();
  for (const source of virtual.values()) {
    const group = groups.get(source.group) ?? [];
    group.push(source);
    groups.set(source.group, group);
  }
  for (const group of groups.values()) {
    activeFiles = new Set(group.map((source) => source.path));
    const program = ts.createProgram([...activeFiles], options, host);
    for (const diagnostic of program.getOptionsDiagnostics())
      record(diagnostic);
    let dirty = false;
    for (const source of group) {
      const syntax = program.getSyntacticDiagnostics(
        program.getSourceFile(source.path),
      );
      if (syntax.length) dirty = true;
      syntax.forEach(record);
    }
    for (const source of group) {
      if (dirty) {
        for (const part of source.parts)
          if (!part.diagnostics.length)
            part.diagnostics.push({
              code: "syntax-group",
              line: part.line,
              column: 1,
              message:
                "Type checking is blocked by a syntax error in this virtual group.",
            });
      } else if (source.parts[0].metadata.check !== "syntax") {
        program
          .getSemanticDiagnostics(program.getSourceFile(source.path))
          .forEach(record);
      }
    }
  }
  for (const snippet of snippets) {
    for (const expectation of snippet.expected)
      if (!expectation.matched)
        snippet.diagnostics.push({
          code: "expectation",
          line: expectation.line,
          column: 1,
          message: `Expected TS${expectation.code} was not reported on this line.`,
        });
    snippet.status = snippet.diagnostics.length
      ? "error"
      : snippet.metadata.check === "syntax"
        ? "syntax-only"
        : snippet.expected.length
          ? "negative"
          : "checked";
  }
  const counts = {
    files: documents.length,
    packageEntries: Object.keys(entries).length,
    total: snippets.length,
    checked: 0,
    negative: 0,
    "syntax-only": 0,
    error: 0,
  };
  const categories = {};
  for (const snippet of snippets) {
    counts[snippet.status]++;
    categories[snippet.category] = (categories[snippet.category] ?? 0) + 1;
  }
  if (!snippets.length)
    errors.push({
      file: "<corpus>",
      line: 1,
      code: "empty",
      message: "The selected documentation contains zero TypeScript fences.",
    });
  return { counts, categories, errors, snippets };
}

export function main(args = process.argv.slice(2)) {
  let filter;
  let json;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--filter" && args[0]) filter = args.shift();
    else if (flag === "--json" && args[0]) json = args.shift();
    else
      throw new Error(
        `Unknown or incomplete argument: ${flag}. Use --filter <path> or --json <path|->.`,
      );
  }
  const documents = discoverCorpus()
    .filter(({ file }) => !filter || relative(repoRoot, file).includes(filter))
    .map(({ file, category }) => ({
      file: relative(repoRoot, file),
      category,
      text: readFileSync(file, "utf8"),
    }));
  const report = {
    complete: !filter,
    filter: filter ?? null,
    ...checkDocuments(documents),
  };
  if (json) {
    const value = JSON.stringify(report, null, 2) + "\n";
    if (json === "-") process.stdout.write(value);
    else writeFileSync(json, value);
  }
  if (json !== "-") {
    for (const error of report.errors)
      console.error(
        `${error.file}:${error.line} ${error.code}: ${error.message}`,
      );
    for (const snippet of report.snippets)
      for (const error of snippet.diagnostics)
        console.error(
          `${snippet.file}:${error.line}:${error.column} [${snippet.group}] ${typeof error.code === "number" ? "TS" : ""}${error.code}: ${error.message}`,
        );
    console.log(
      `${report.complete ? "Complete corpus" : "FILTERED RUN (not a complete corpus check)"}: ${JSON.stringify(report.counts)}; categories ${JSON.stringify(report.categories)}`,
    );
    for (const snippet of report.snippets.filter(
      (snippet) => snippet.status === "syntax-only",
    ))
      console.log(
        `Syntax only: ${snippet.id}:${snippet.line}: ${snippet.metadata.reason}`,
      );
  }
  if (report.errors.length || report.counts.error) process.exitCode = 1;
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
