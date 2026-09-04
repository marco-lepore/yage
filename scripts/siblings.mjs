#!/usr/bin/env node
/* global console, process */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

function walk(dir, output = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (entry === "dist" || entry === "node_modules" || entry.startsWith(".")) {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, output);
    else if (/\.tsx?$/.test(entry) && !/\.(?:test|spec)\.tsx?$/.test(entry)) {
      output.push(path);
    }
  }
  return output;
}

function packageRoots(root) {
  const roots = [];
  const packages = join(root, "packages");
  for (const entry of readdirSync(packages)) {
    const path = join(packages, entry);
    if (!statSync(path).isDirectory()) continue;
    if (entry === "addons" || entry === "tools") {
      for (const child of readdirSync(path)) {
        const childPath = join(path, child);
        if (existsSync(join(childPath, "package.json"))) roots.push(childPath);
      }
    } else if (existsSync(join(path, "package.json"))) {
      roots.push(path);
    }
  }
  return roots;
}

function workspaceProgram(root) {
  const roots = packageRoots(root);
  const files = roots.flatMap((packageRoot) => walk(join(packageRoot, "src")));
  const paths = {};
  for (const packageRoot of roots) {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    );
    const entry = ["src/index.ts", "src/index.tsx"].find((candidate) =>
      existsSync(join(packageRoot, candidate)),
    );
    if (entry) paths[manifest.name] = [join(packageRoot, entry)];
    paths[`${manifest.name}/*`] = [join(packageRoot, "src/*")];
  }
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    types: [],
    baseUrl: root,
    paths,
  });
  return { program, files: new Set(files), root };
}

function symbolForExpression(checker, expression) {
  let symbol = checker.getSymbolAtLocation(expression);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol;
}

function declaredMethods(node) {
  const methods = new Map();
  for (const member of node.members) {
    if (
      (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member)) &&
      member.name &&
      ts.isIdentifier(member.name)
    ) {
      methods.set(member.name.text, member);
    }
  }
  return methods;
}

function earlyReturnGuard(method) {
  const first = method.body?.statements[0];
  return Boolean(
    first &&
    ts.isIfStatement(first) &&
    !first.elseStatement &&
    first.thenStatement.getText().includes("return"),
  );
}

function analyze(program, includedFiles, root, methodName) {
  const checker = program.getTypeChecker();
  const classes = [];
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || !includedFiles.has(source.fileName))
      continue;
    ts.forEachChild(source, function visit(node) {
      if (ts.isClassDeclaration(node) && node.name) {
        classes.push({
          node,
          source,
          name: node.name.text,
          symbol: checker.getSymbolAtLocation(node.name),
          file: relative(root, source.fileName).split(sep).join("/"),
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          methods: declaredMethods(node),
        });
      }
      ts.forEachChild(node, visit);
    });
  }
  const bySymbol = new Map(
    classes
      .filter((entry) => entry.symbol)
      .map((entry) => [entry.symbol, entry]),
  );

  const directChildren = new Map();
  const directInterfaces = new Map();
  const parentOf = new Map();
  for (const entry of classes) {
    for (const clause of entry.node.heritageClauses ?? []) {
      for (const type of clause.types) {
        const symbol = symbolForExpression(checker, type.expression);
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          const parent = symbol ? bySymbol.get(symbol) : undefined;
          if (parent) {
            parentOf.set(entry, parent);
            const children = directChildren.get(parent) ?? [];
            children.push(entry);
            directChildren.set(parent, children);
          }
        } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
          const name = symbol?.getName() ?? type.expression.getText();
          const interfaces = directInterfaces.get(entry) ?? [];
          interfaces.push(name);
          directInterfaces.set(entry, interfaces);
        }
      }
    }
  }

  const implementers = new Map();
  for (const entry of classes) {
    const names = new Set();
    let cursor = entry;
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      for (const name of directInterfaces.get(cursor) ?? []) names.add(name);
      cursor = parentOf.get(cursor);
    }
    for (const name of names) {
      const members = implementers.get(name) ?? [];
      members.push(entry);
      implementers.set(name, members);
    }
  }

  const families = [
    ...[...directChildren].map(([base, members]) => ({
      kind: "class",
      name: base.name,
      members,
    })),
    ...[...implementers].map(([name, members]) => ({
      kind: "interface",
      name,
      members,
    })),
  ];

  return families
    .filter((family) => family.members.length >= 3)
    .map((family) => {
      const defining = family.members.filter((member) =>
        member.methods.has(methodName),
      );
      const missing = family.members.filter(
        (member) => !member.methods.has(methodName),
      );
      return {
        ...family,
        defining,
        missing,
        guarded: defining.filter((member) =>
          earlyReturnGuard(member.methods.get(methodName)),
        ),
      };
    })
    .filter((family) => family.defining.length > 0)
    .sort((left, right) =>
      `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`),
    );
}

function syntheticProgram() {
  const path = "/synthetic/siblings.ts";
  const code = `
    interface Element {}
    class Base {}
    class A extends Base implements Element { destroy(): void { if (this.done) return; } done = false; }
    class B extends Base implements Element { destroy(): void {} }
    class C extends Base implements Element { destroy(): void { if (this.done) return; } done = false; }
    class D extends Base implements Element {}
  `;
  const options = { target: ts.ScriptTarget.ESNext, noLib: true };
  const host = ts.createCompilerHost(options);
  host.fileExists = (candidate) => candidate === path;
  host.readFile = (candidate) => (candidate === path ? code : undefined);
  host.getSourceFile = (candidate, languageVersion) =>
    candidate === path
      ? ts.createSourceFile(candidate, code, languageVersion, true)
      : undefined;
  const program = ts.createProgram([path], options, host);
  return { program, files: new Set([path]), root: "/synthetic" };
}

function verifyPositiveControls() {
  const fixture = syntheticProgram();
  const families = analyze(
    fixture.program,
    fixture.files,
    fixture.root,
    "destroy",
  );
  const base = families.find(
    (family) => family.kind === "class" && family.name === "Base",
  );
  const element = families.find(
    (family) => family.kind === "interface" && family.name === "Element",
  );
  if (
    !base ||
    !element ||
    base.defining.length !== 3 ||
    base.missing.length !== 1 ||
    base.guarded.length !== 2 ||
    element.members.length !== 4
  ) {
    throw new Error("siblings: synthetic class/interface control failed");
  }
}

function formatMembers(members) {
  return members.length
    ? members
        .map((member) => `${member.name} (${member.file}:${member.line})`)
        .join(", ")
    : "none";
}

function main() {
  const methodName = process.argv[2];
  if (!methodName || !/^[A-Za-z_$][\w$]*$/.test(methodName)) {
    console.error("Usage: npm run siblings -- <methodName>");
    process.exitCode = 1;
    return;
  }
  verifyPositiveControls();
  const workspace = workspaceProgram(repoRoot);
  const families = analyze(
    workspace.program,
    workspace.files,
    workspace.root,
    methodName,
  );
  if (families.length === 0) {
    console.log(`No sibling families define ${methodName}().`);
    return;
  }
  for (const family of families) {
    console.log(
      `${family.kind} ${family.name}: ${family.members.length} members; ${family.defining.length} define ${methodName}()`,
    );
    console.log(`  defines: ${formatMembers(family.defining)}`);
    console.log(`  missing: ${formatMembers(family.missing)}`);
    console.log(`  early-return guard: ${formatMembers(family.guarded)}`);
  }
  console.log(
    "Sibling differences are leads to inspect, not proof that every sibling should match.",
  );
}

main();
