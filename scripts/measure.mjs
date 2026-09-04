#!/usr/bin/env node
/* global console, process */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import {
  dirname,
  extname,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

function sourceFile(path, code) {
  const kind = extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, kind);
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function finding(check, path, line, message) {
  return { check, path, line, message };
}

function isProductionTypeScript(path) {
  return /\.tsx?$/.test(path) && !/\.(?:test|spec)\.tsx?$/.test(path);
}

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
    else if (isProductionTypeScript(path)) output.push(path);
  }
  return output;
}

export function loadRepositorySources(root = repoRoot) {
  return walk(join(root, "packages")).map((path) => ({
    path: relative(root, path).split(sep).join("/"),
    code: readFileSync(path, "utf8"),
  }));
}

function packageDirectories(root) {
  const directories = [];
  function visit(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes("package.json") && entries.includes("src")) {
      directories.push(dir);
      return;
    }
    for (const entry of entries) {
      if (
        entry === "dist" ||
        entry === "node_modules" ||
        entry.startsWith(".")
      ) {
        continue;
      }
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) visit(path);
    }
  }
  visit(join(root, "packages"));
  return directories;
}

export function loadRepositoryPackages(root = repoRoot) {
  return packageDirectories(root).map((directory) => ({
    directory: relative(root, directory).split(sep).join("/"),
    manifest: JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
    files: walk(join(directory, "src")).map((path) => ({
      path: relative(root, path).split(sep).join("/"),
      code: readFileSync(path, "utf8"),
    })),
  }));
}

function packageLabel(path) {
  const parts = path.split("/");
  if (parts[0] !== "packages") return "unknown";
  if (parts[1] === "addons" || parts[1] === "tools")
    return parts[2] ?? "unknown";
  return parts[1] ?? "unknown";
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function classBaseName(node) {
  const clause = node.heritageClauses?.find(
    (candidate) => candidate.token === ts.SyntaxKind.ExtendsKeyword,
  );
  const type = clause?.types[0];
  return type ? type.expression.getText() : undefined;
}

function numericInitializer(node) {
  if (!node) return undefined;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  return undefined;
}

function classProperty(node, name) {
  return node.members.find(
    (member) =>
      ts.isPropertyDeclaration(member) &&
      member.name !== undefined &&
      member.name.getText() === name,
  );
}

function parseDocumentSystems(document) {
  const systems = [];
  const pattern = /`([A-Za-z_$][\w$]*System)`?\s*\((-?\d+),\s*([\w-]+)\)`?/g;
  for (const match of document.code.matchAll(pattern)) {
    const lineStart = document.code.lastIndexOf("\n", match.index) + 1;
    const lineEnd = document.code.indexOf("\n", match.index);
    const line = document.code.slice(
      lineStart,
      lineEnd === -1 ? document.code.length : lineEnd,
    );
    const phase = line.match(
      /(?:`|\*\*)(EarlyUpdate|FixedUpdate|Update|LateUpdate|Render|EndOfFrame)(?:`|\*\*)/,
    )?.[1];
    systems.push({
      key: `${match[1]}|${phase ?? "unknown"}|${match[2]}|${match[3]}`,
      className: match[1],
      phase,
      priority: Number(match[2]),
      packageName: match[3],
      path: document.path,
      line: document.code.slice(0, match.index).split("\n").length,
    });
  }
  return systems;
}

function collectSourceSystems(files) {
  const classes = new Map();
  const sourcePaths = new Set(files.map((file) => file.path));
  for (const file of files) {
    const source = sourceFile(file.path, file.code);
    const imports = new Map();
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.importClause?.namedBindings ||
        !ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        continue;
      }
      for (const element of statement.importClause.namedBindings.elements) {
        imports.set(element.name.text, {
          importedName: element.propertyName?.text ?? element.name.text,
          specifier: statement.moduleSpecifier.text,
        });
      }
    }
    ts.forEachChild(source, function visit(node) {
      if (ts.isClassDeclaration(node) && node.name) {
        classes.set(`${file.path}\0${node.name.text}`, {
          node,
          source,
          file,
          base: classBaseName(node),
          imports,
        });
      }
      ts.forEachChild(node, visit);
    });
  }

  function importedPath(filePath, specifier) {
    if (!specifier.startsWith(".")) return undefined;
    const base = posix.normalize(
      posix.join(posix.dirname(filePath), specifier),
    );
    const candidates = base.endsWith(".js")
      ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
      : [
          base,
          `${base}.ts`,
          `${base}.tsx`,
          `${base}/index.ts`,
          `${base}/index.tsx`,
        ];
    return candidates.find((candidate) => sourcePaths.has(candidate));
  }

  function parentOf(info) {
    if (!info.base) return undefined;
    const local = classes.get(`${info.file.path}\0${info.base}`);
    if (local) return local;
    const imported = info.imports.get(info.base);
    if (!imported) return undefined;
    const path = importedPath(info.file.path, imported.specifier);
    return path ? classes.get(`${path}\0${imported.importedName}`) : undefined;
  }

  function inheritsSystem(info, seen = new Set()) {
    if (!info.base) return false;
    if (info.base === "System") return true;
    if (seen.has(info)) return false;
    seen.add(info);
    const parent = parentOf(info);
    return parent ? inheritsSystem(parent, seen) : false;
  }

  function inheritedProperty(info, name, seen = new Set()) {
    const own = classProperty(info.node, name);
    if (own) return own;
    if (!info.base || seen.has(info)) return undefined;
    seen.add(info);
    const parent = parentOf(info);
    return parent ? inheritedProperty(parent, name, seen) : undefined;
  }

  const systems = [];
  const errors = [];
  for (const info of classes.values()) {
    const className = info.node.name.text;
    if (
      !inheritsSystem(info) ||
      hasModifier(info.node, ts.SyntaxKind.AbstractKeyword)
    ) {
      continue;
    }
    const phaseNode = inheritedProperty(info, "phase")?.initializer;
    const priorityNode = inheritedProperty(info, "priority")?.initializer;
    const phaseMatch = phaseNode?.getText().match(/^Phase\.([A-Za-z]+)$/);
    const priority = numericInitializer(priorityNode);
    if (!phaseMatch || priority === undefined) {
      errors.push(
        finding(
          "system-doc-parity",
          info.file.path,
          lineOf(info.source, info.node),
          `${className} must declare or inherit literal Phase.X and numeric priority values.`,
        ),
      );
      continue;
    }
    const packageName = packageLabel(info.file.path);
    systems.push({
      key: `${className}|${phaseMatch[1]}|${priority}|${packageName}`,
      className,
      phase: phaseMatch[1],
      priority,
      packageName,
      path: info.file.path,
      line: lineOf(info.source, info.node),
    });
  }
  return { systems, errors };
}

export function checkSystemDocParity({ sourceFiles, documents }) {
  const { systems, errors } = collectSourceSystems(sourceFiles);
  const sourceByKey = new Map(systems.map((system) => [system.key, system]));
  for (const document of documents) {
    const documented = parseDocumentSystems(document);
    const documentedByKey = new Map();
    for (const system of documented) {
      const count = documentedByKey.get(system.key)?.count ?? 0;
      documentedByKey.set(system.key, { system, count: count + 1 });
    }
    for (const [key, sourceSystem] of sourceByKey) {
      if (!documentedByKey.has(key)) {
        errors.push(
          finding(
            "system-doc-parity",
            document.path,
            1,
            `${sourceSystem.className} (${sourceSystem.phase}, ${sourceSystem.priority}, ${sourceSystem.packageName}) is missing or differs from source.`,
          ),
        );
      }
    }
    for (const [key, entry] of documentedByKey) {
      if (!sourceByKey.has(key)) {
        errors.push(
          finding(
            "system-doc-parity",
            entry.system.path,
            entry.system.line,
            `${entry.system.className} (${entry.system.phase ?? "unknown phase"}, ${entry.system.priority}, ${entry.system.packageName}) has no matching source system.`,
          ),
        );
      }
      if (entry.count > 1) {
        errors.push(
          finding(
            "system-doc-parity",
            entry.system.path,
            entry.system.line,
            `${entry.system.className} (${entry.system.phase ?? "unknown phase"}, ${entry.system.priority}, ${entry.system.packageName}) is listed ${entry.count} times.`,
          ),
        );
      }
    }
  }
  return errors;
}

function exportedOptionsMembers(node) {
  if (
    !hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
    !node.name.text.endsWith("Options")
  ) {
    return [];
  }
  if (ts.isInterfaceDeclaration(node)) return node.members;
  if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
    return node.type.members;
  }
  return [];
}

function isAllowedClockType(node) {
  if (ts.isParenthesizedTypeNode(node)) return isAllowedClockType(node.type);
  if (ts.isUnionTypeNode(node)) return node.types.every(isAllowedClockType);
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  return (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    (node.typeName.text === "ProcessClock" ||
      node.typeName.text === "InputClock")
  );
}

export function checkClockOptionTypes(files) {
  const errors = [];
  for (const file of files) {
    const source = sourceFile(file.path, file.code);
    ts.forEachChild(source, function visit(node) {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        for (const member of exportedOptionsMembers(node)) {
          if (
            ts.isPropertySignature(member) &&
            member.name?.getText() === "clock" &&
            (!member.type || !isAllowedClockType(member.type))
          ) {
            errors.push(
              finding(
                "clock-option-types",
                file.path,
                lineOf(source, member),
                `${node.name.text}.clock must use ProcessClock or InputClock, not ${member.type?.getText() ?? "an inferred type"}.`,
              ),
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    });
  }
  return errors;
}

function serviceKeyDeclarations(files) {
  const declarations = [];
  for (const file of files) {
    const source = sourceFile(file.path, file.code);
    ts.forEachChild(source, function visit(node) {
      if (
        ts.isNewExpression(node) &&
        node.expression.getText() === "ServiceKey" &&
        node.arguments?.length &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const statement = node.parent.parent.parent;
        declarations.push({
          id: node.arguments[0].text,
          file,
          source,
          node,
          exported: hasModifier(statement, ts.SyntaxKind.ExportKeyword),
          line: lineOf(source, node),
        });
      }
      ts.forEachChild(node, visit);
    });
  }
  return declarations;
}

export function checkServiceKeyOwnership(files) {
  const byId = new Map();
  for (const declaration of serviceKeyDeclarations(files)) {
    const list = byId.get(declaration.id) ?? [];
    list.push(declaration);
    byId.set(declaration.id, list);
  }
  const errors = [];
  for (const [id, declarations] of byId) {
    if (declarations.length < 2) continue;
    const owner =
      declarations.find((declaration) => declaration.exported) ??
      declarations[0];
    const ownerPackage = packageLabel(owner.file.path);
    for (const declaration of declarations) {
      if (declaration === owner) continue;
      const lines = declaration.file.code.split("\n");
      const nearby = lines
        .slice(Math.max(0, declaration.line - 7), declaration.line - 1)
        .join("\n");
      const explainsOwnership =
        new RegExp(
          `\\b${ownerPackage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i",
        ).test(nearby) ||
        /duplicate|re-declar|well-known|service id|runtime dep/i.test(nearby);
      if (!explainsOwnership) {
        errors.push(
          finding(
            "service-key-ownership",
            declaration.file.path,
            declaration.line,
            `ServiceKey id "${id}" is owned by ${owner.file.path}; explain why this declaration repeats it.`,
          ),
        );
      }
    }
  }
  return errors;
}

const nodeBuiltins = new Set(
  builtinModules.filter((name) => !name.startsWith("node:")),
);

function dependencyName(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("node:")
  ) {
    return undefined;
  }
  const parts = specifier.split("/");
  const name = specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];
  if (!name || nodeBuiltins.has(specifier) || nodeBuiltins.has(name)) {
    return undefined;
  }
  return name;
}

function packageSpecifiers(source) {
  const specifiers = [];
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      const clause = statement.importClause;
      const namedBindings = clause?.namedBindings;
      const namedTypesOnly =
        namedBindings &&
        ts.isNamedImports(namedBindings) &&
        namedBindings.elements.length > 0 &&
        namedBindings.elements.every((element) => element.isTypeOnly);
      specifiers.push({
        specifier: statement.moduleSpecifier.text,
        node: statement.moduleSpecifier,
        kind:
          clause?.isTypeOnly || (namedTypesOnly && !clause.name)
            ? "type"
            : "value",
      });
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      const clause = statement.exportClause;
      const namedTypesOnly =
        clause &&
        ts.isNamedExports(clause) &&
        clause.elements.length > 0 &&
        clause.elements.every((element) => element.isTypeOnly);
      specifiers.push({
        specifier: statement.moduleSpecifier.text,
        node: statement.moduleSpecifier,
        kind: statement.isTypeOnly || namedTypesOnly ? "type" : "value",
      });
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      ts.isStringLiteralLike(statement.moduleReference.expression)
    ) {
      specifiers.push({
        specifier: statement.moduleReference.expression.text,
        node: statement.moduleReference.expression,
        kind: statement.isTypeOnly ? "type" : "value",
      });
    }
  }
  ts.forEachChild(source, function visit(node) {
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push({
        specifier: node.argument.literal.text,
        node: node.argument.literal,
        kind: "type",
      });
    }
    if (ts.isCallExpression(node)) {
      const firstArgument = node.arguments[0];
      const isDynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length >= 1;
      const isRequire =
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length === 1;
      if (
        firstArgument &&
        ts.isStringLiteralLike(firstArgument) &&
        (isDynamicImport || isRequire)
      ) {
        specifiers.push({
          specifier: firstArgument.text,
          node: firstArgument,
          kind: "value",
        });
      }
    }
    ts.forEachChild(node, visit);
  });
  return specifiers;
}

export function checkPackageImportBoundaries(packages) {
  const errors = [];
  for (const packageInfo of packages) {
    const runtimeDependencies = new Set([
      ...Object.keys(packageInfo.manifest.dependencies ?? {}),
      ...Object.keys(packageInfo.manifest.peerDependencies ?? {}),
    ]);
    const typeDependencies = new Set([
      ...runtimeDependencies,
      ...Object.keys(packageInfo.manifest.devDependencies ?? {}),
    ]);
    for (const file of packageInfo.files) {
      const source = sourceFile(file.path, file.code);
      for (const imported of packageSpecifiers(source)) {
        const dependency = dependencyName(imported.specifier);
        const allowed =
          imported.kind === "type" ? typeDependencies : runtimeDependencies;
        if (
          dependency === undefined ||
          dependency === packageInfo.manifest.name ||
          allowed.has(dependency)
        ) {
          continue;
        }
        errors.push(
          finding(
            "package-import-boundary",
            file.path,
            lineOf(source, imported.node),
            imported.kind === "type"
              ? `Type-only import "${imported.specifier}" requires ${dependency} in dependencies, peerDependencies, or devDependencies.`
              : `Runtime import "${imported.specifier}" requires ${dependency} in dependencies or peerDependencies.`,
          ),
        );
      }
    }
  }
  return errors;
}

function identifierFindings(files, check, name, message) {
  const errors = [];
  for (const file of files) {
    const source = sourceFile(file.path, file.code);
    ts.forEachChild(source, function visit(node) {
      if (ts.isIdentifier(node) && node.text === name) {
        errors.push(finding(check, file.path, lineOf(source, node), message));
      }
      ts.forEachChild(node, visit);
    });
  }
  return errors;
}

export function checkRemovedDestroyEntity(files) {
  return identifierFindings(
    files,
    "removed-destroy-entity",
    "destroyEntity",
    "destroyEntity is removed; use Entity.destroy().",
  );
}

export function checkRemovedOnRemove(files) {
  return identifierFindings(
    files,
    "removed-on-remove",
    "onRemove",
    "onRemove is removed; use the supported component lifecycle hooks.",
  );
}

function unwrapExpression(node) {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function propertyReference(node) {
  const unwrapped = unwrapExpression(node);
  return ts.isPropertyAccessExpression(unwrapped)
    ? {
        receiver: unwrapped.expression.getText(),
        property: unwrapped.name.text,
      }
    : undefined;
}

function negatedPropertyReference(node) {
  const unwrapped = unwrapExpression(node);
  if (
    !ts.isPrefixUnaryExpression(unwrapped) ||
    unwrapped.operator !== ts.SyntaxKind.ExclamationToken
  ) {
    return undefined;
  }
  return propertyReference(unwrapped.operand);
}

export function checkComposedEntityLiveness(files) {
  const errors = [];
  for (const file of files) {
    const source = sourceFile(file.path, file.code);
    ts.forEachChild(source, function visit(node) {
      if (ts.isBinaryExpression(node)) {
        const leftProperty = propertyReference(node.left);
        const rightProperty = propertyReference(node.right);
        const leftNegated = negatedPropertyReference(node.left);
        const rightNegated = negatedPropertyReference(node.right);
        const forbiddenOr =
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
          ((leftProperty?.property === "isDestroyed" &&
            rightNegated?.property === "isActive" &&
            leftProperty.receiver === rightNegated.receiver) ||
            (rightProperty?.property === "isDestroyed" &&
              leftNegated?.property === "isActive" &&
              rightProperty.receiver === leftNegated.receiver));
        const forbiddenAnd =
          node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
          ((leftProperty?.property === "isActive" &&
            rightNegated?.property === "isDestroyed" &&
            leftProperty.receiver === rightNegated.receiver) ||
            (rightProperty?.property === "isActive" &&
              leftNegated?.property === "isDestroyed" &&
              rightProperty.receiver === leftNegated.receiver));
        if (forbiddenOr || forbiddenAnd) {
          errors.push(
            finding(
              "composed-entity-liveness",
              file.path,
              lineOf(source, node),
              "Use the single entity-state predicate instead of composing isDestroyed and isActive.",
            ),
          );
        }
      }
      ts.forEachChild(node, visit);
    });
  }
  return errors;
}

export function checkAddonContextRegistration(files) {
  const contextNames = new Set([
    "context",
    "ctx",
    "engineContext",
    "pluginContext",
  ]);
  function isContextReceiver(node) {
    if (ts.isIdentifier(node)) return contextNames.has(node.text);
    return (
      ts.isPropertyAccessExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ThisKeyword &&
      contextNames.has(node.name.text)
    );
  }
  const errors = [];
  for (const file of files) {
    if (!file.path.startsWith("packages/addons/")) continue;
    const source = sourceFile(file.path, file.code);
    ts.forEachChild(source, function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        isContextReceiver(node.expression.expression)
      ) {
        const owner = node.expression.expression.getText();
        const method = node.expression.name.text;
        if (method === "register" || method === "registerScoped") {
          errors.push(
            finding(
              "addon-context-registration",
              file.path,
              lineOf(source, node),
              `Addons must not call ${owner}.${method}(); keep entity-hosted state in the ECS.`,
            ),
          );
        }
      }
      ts.forEachChild(node, visit);
    });
  }
  return errors;
}

export function checkInlineImportTypes(files) {
  function hasCircularDependencyException(file, source, node) {
    const line = lineOf(source, node) - 1;
    const lines = file.code.split("\n");
    const comments = [];
    for (let index = line - 1; index >= 0 && index >= line - 4; index -= 1) {
      const text = lines[index].trim();
      if (
        text.startsWith("//") ||
        text.startsWith("/*") ||
        text.startsWith("*") ||
        text.endsWith("*/")
      ) {
        comments.unshift(text);
        continue;
      }
      break;
    }
    const explanation = comments.join(" ");
    return (
      /\b(?:breaks?|avoids?)\b/i.test(explanation) &&
      /\bunavoidable circular type dependency\b/i.test(explanation)
    );
  }
  const errors = [];
  for (const file of files) {
    const source = sourceFile(file.path, file.code);
    ts.forEachChild(source, function visit(node) {
      if (
        ts.isImportTypeNode(node) &&
        !hasCircularDependencyException(file, source, node)
      ) {
        errors.push(
          finding(
            "inline-import-type",
            file.path,
            lineOf(source, node),
            `Use a top-level import type declaration instead of ${node.getText()}.`,
          ),
        );
      }
      ts.forEachChild(node, visit);
    });
  }
  return errors;
}

export function checkVec2VoidMethods(files) {
  const errors = [];
  for (const file of files) {
    if (!/(?:^|\/)Vec2\.ts$/.test(file.path)) continue;
    const source = sourceFile(file.path, file.code);
    ts.forEachChild(source, function visit(node) {
      if (
        (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) &&
        node.type?.kind === ts.SyntaxKind.VoidKeyword
      ) {
        errors.push(
          finding(
            "vec2-void-method",
            file.path,
            lineOf(source, node),
            `Vec2.${node.name.getText()}() returns void; Vec2 operations must return a value.`,
          ),
        );
      }
      ts.forEachChild(node, visit);
    });
  }
  return errors;
}

function engineEventKeys(files) {
  const keys = new Set();
  for (const file of files) {
    if (!file.path.endsWith("packages/core/src/EventBus.ts")) continue;
    const source = sourceFile(file.path, file.code);
    ts.forEachChild(source, function visit(node) {
      if (
        ts.isInterfaceDeclaration(node) &&
        node.name.text === "EngineEvents"
      ) {
        for (const member of node.members) {
          if (
            ts.isPropertySignature(member) &&
            member.name &&
            ts.isStringLiteral(member.name)
          ) {
            keys.add(member.name.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    });
  }
  return keys;
}

export function checkCoreEventBusKeys(files) {
  const eventBusNames = new Set(["bus", "events", "eventBus"]);
  function isEventBusReceiver(node) {
    if (ts.isIdentifier(node)) return eventBusNames.has(node.text);
    return (
      ts.isPropertyAccessExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ThisKeyword &&
      eventBusNames.has(node.name.text)
    );
  }
  const keys = engineEventKeys(files);
  const errors = [];
  for (const file of files) {
    if (!file.path.startsWith("packages/core/src/")) continue;
    const source = sourceFile(file.path, file.code);
    ts.forEachChild(source, function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "emit" &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        if (
          isEventBusReceiver(node.expression.expression) &&
          !keys.has(node.arguments[0].text)
        ) {
          errors.push(
            finding(
              "core-event-bus-key",
              file.path,
              lineOf(source, node),
              `Event key "${node.arguments[0].text}" is absent from EngineEvents.`,
            ),
          );
        }
      }
      ts.forEachChild(node, visit);
    });
  }
  return errors;
}

export function positiveControlFailures() {
  const systemSource = {
    path: "packages/control/src/ControlSystem.ts",
    code: `
      abstract class System { abstract readonly phase: Phase; readonly priority = 0; }
      export class ControlSystem extends System { readonly phase = Phase.Update; }
    `,
  };
  const controls = [
    {
      name: "system-doc-parity",
      passed:
        checkSystemDocParity({
          sourceFiles: [systemSource],
          documents: [
            {
              path: "control-a.md",
              code: "- `Update`: `DifferentSystem (0, control)`",
            },
            {
              path: "control-b.md",
              code: "| **Update** | `ControlSystem` (0, control) |",
            },
          ],
        }).length > 0,
    },
    {
      name: "clock-option-types",
      passed:
        checkClockOptionTypes([
          {
            path: "packages/control/src/options.ts",
            code: "export interface ControlOptions { clock?: number }",
          },
        ]).length === 1,
    },
    {
      name: "service-key-ownership",
      passed:
        checkServiceKeyOwnership([
          {
            path: "packages/control/src/key.ts",
            code: 'export const ControlKey = new ServiceKey<string>("control");',
          },
          {
            path: "packages/other/src/key.ts",
            code: 'const OtherKey = new ServiceKey<string>("control");',
          },
        ]).length === 1,
    },
    {
      name: "package-import-boundary",
      passed:
        checkPackageImportBoundaries([
          {
            directory: "packages/addons/control",
            manifest: {
              name: "@yagejs-addons/control",
              devDependencies: { "missing-runtime": "1.0.0" },
            },
            files: [
              {
                path: "packages/addons/control/src/index.ts",
                code: 'import value from "missing-runtime";',
              },
            ],
          },
        ]).length === 1,
    },
    {
      name: "removed-destroy-entity",
      passed:
        checkRemovedDestroyEntity([
          {
            path: "packages/control/src/a.ts",
            code: "scene.destroyEntity(entity);",
          },
        ]).length === 1,
    },
    {
      name: "removed-on-remove",
      passed:
        checkRemovedOnRemove([
          {
            path: "packages/control/src/a.ts",
            code: "class C { onRemove(): void {} }",
          },
        ]).length === 1,
    },
    {
      name: "composed-entity-liveness",
      passed:
        checkComposedEntityLiveness([
          {
            path: "packages/control/src/a.ts",
            code: "if (entity.isDestroyed || !entity.isActive) return;",
          },
        ]).length === 1,
    },
    {
      name: "addon-context-registration",
      passed:
        checkAddonContextRegistration([
          {
            path: "packages/addons/control/src/a.ts",
            code: "this.context.register(ControlKey, value);",
          },
        ]).length === 1,
    },
    {
      name: "inline-import-type",
      passed:
        checkInlineImportTypes([
          {
            path: "packages/control/src/a.ts",
            code: 'function consume(value: import("./value.js").Value): void {}',
          },
        ]).length === 1,
    },
    {
      name: "vec2-void-method",
      passed:
        checkVec2VoidMethods([
          {
            path: "packages/core/src/Vec2.ts",
            code: "class Vec2 { mutate(): void {} }",
          },
        ]).length === 1,
    },
    {
      name: "core-event-bus-key",
      passed:
        checkCoreEventBusKeys([
          {
            path: "packages/core/src/EventBus.ts",
            code: 'interface EngineEvents { "known": undefined }',
          },
          {
            path: "packages/core/src/Engine.ts",
            code: 'eventBus.emit("unknown", undefined);',
          },
        ]).length === 1,
    },
  ];
  return controls
    .filter((control) => !control.passed)
    .map((control) => control.name);
}

export function runChecks(root = repoRoot) {
  const sources = loadRepositorySources(root);
  return [
    ...checkSystemDocParity({
      sourceFiles: sources,
      documents: [
        {
          path: "docs/llms/packages/core.md",
          code: readFileSync(join(root, "docs/llms/packages/core.md"), "utf8"),
        },
        {
          path: "docs/src/content/docs/concepts/game-loop.mdx",
          code: readFileSync(
            join(root, "docs/src/content/docs/concepts/game-loop.mdx"),
            "utf8",
          ),
        },
      ],
    }),
    ...checkClockOptionTypes(sources),
    ...checkServiceKeyOwnership(sources),
    ...checkPackageImportBoundaries(loadRepositoryPackages(root)),
    ...checkRemovedDestroyEntity(sources),
    ...checkRemovedOnRemove(sources),
    ...checkComposedEntityLiveness(sources),
    ...checkAddonContextRegistration(sources),
    ...checkInlineImportTypes(sources),
    ...checkVec2VoidMethods(sources),
    ...checkCoreEventBusKeys(sources),
  ];
}

function main() {
  const brokenControls = positiveControlFailures();
  if (brokenControls.length > 0) {
    for (const name of brokenControls) {
      console.error(`measure: positive control failed for ${name}`);
    }
    process.exitCode = 1;
    return;
  }

  const errors = runChecks();
  if (errors.length === 0) {
    console.log("measure: all repository checks passed");
    return;
  }
  for (const error of errors) {
    console.error(
      `${error.path}:${error.line} [${error.check}] ${error.message}`,
    );
  }
  console.error(`measure: ${errors.length} error(s)`);
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
