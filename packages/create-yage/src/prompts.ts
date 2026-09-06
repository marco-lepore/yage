import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  select,
  text,
} from "@clack/prompts";
import pc from "picocolors";
import type { TemplateId } from "./templates.js";
import { DEFAULT_TEMPLATE, TEMPLATES } from "./templates.js";
import type { FeatureId } from "./features.js";
import { FEATURES } from "./features.js";
import type { DirectoryState } from "./utils.js";
import {
  deriveProjectName,
  relativeFromCwd,
  validateProjectName,
} from "./utils.js";

export interface ResolvedOptions {
  targetDir: string;
  projectName: string;
  template: TemplateId;
  features: readonly FeatureId[];
  overwrite: boolean;
  install: boolean;
  git: boolean;
}

export interface PartialOptions {
  targetDirArg?: string;
  template?: TemplateId;
  features?: readonly FeatureId[];
  install?: boolean;
  git?: boolean;
  overwrite?: boolean;
  /** When true, all prompts accept defaults without asking. */
  yes?: boolean;
}

export interface PromptContext {
  inspectTarget: (target: string) => DirectoryState;
  resolveTarget: (input: string) => string;
}

/**
 * Drives the interactive flow, skipping any prompts whose answers have
 * already been supplied via flags. Returns `null` if the user cancels.
 */
export async function runPrompts(
  initial: PartialOptions,
  ctx: PromptContext,
): Promise<ResolvedOptions | null> {
  intro(pc.bgMagenta(pc.black(" create-yage ")));

  // --- project name / target dir ---
  let targetDirInput = initial.targetDirArg;
  if (!targetDirInput) {
    if (initial.yes) {
      targetDirInput = "my-yage-game";
    } else {
      const answer = await text({
        message: "Where should we create your project?",
        placeholder: "./my-yage-game",
        defaultValue: "./my-yage-game",
        validate: (value) => {
          if (!value) return undefined;
          const derived = deriveProjectName(value);
          return validateProjectName(derived);
        },
      });
      if (isCancel(answer)) return cancelFlow();
      targetDirInput = answer;
    }
  }

  const targetDir = ctx.resolveTarget(targetDirInput);
  const projectName = deriveProjectName(targetDir);
  const nameError = validateProjectName(projectName);
  if (nameError) {
    cancel(`Invalid project name "${projectName}": ${nameError}`);
    return null;
  }

  // --- directory collision handling ---
  const dirState = ctx.inspectTarget(targetDir);
  let overwrite = initial.overwrite ?? false;
  if (
    (dirState.kind === "file" || dirState.kind === "non-empty") &&
    !overwrite
  ) {
    const targetDescription =
      dirState.kind === "file"
        ? "Target path is a file"
        : "Target directory is not empty";
    if (initial.yes) {
      cancel(`${targetDescription}: ${targetDir}. Pass --force to overwrite.`);
      return null;
    }
    const choice = await select<"abort" | "overwrite">({
      message:
        dirState.kind === "file"
          ? `${targetDir} is a file. What do you want to do?`
          : `${targetDir} is not empty. What do you want to do?`,
      options: [
        { value: "abort", label: "Abort", hint: "Exit without changes" },
        {
          value: "overwrite",
          label: "Overwrite",
          hint:
            dirState.kind === "file"
              ? "Replace the file and scaffold the project"
              : "Remove existing contents except .git and scaffold the project",
        },
      ],
      initialValue: "abort",
    });
    if (isCancel(choice) || choice === "abort") return cancelFlow();
    overwrite = true;
  }

  // --- template ---
  let template = initial.template;
  if (!template) {
    if (initial.yes) {
      template = DEFAULT_TEMPLATE;
    } else {
      const choice = await select<TemplateId>({
        message: "Which template?",
        options: TEMPLATES.map((t) => ({
          value: t.id,
          label: t.label,
          hint: t.hint,
        })),
        initialValue: DEFAULT_TEMPLATE,
      });
      if (isCancel(choice)) return cancelFlow();
      template = choice;
    }
  }

  // --- install deps? ---
  let install = initial.install;
  if (install === undefined) {
    if (initial.yes) {
      install = true;
    } else {
      const answer = await confirm({
        message: "Install dependencies with npm?",
        initialValue: true,
      });
      if (isCancel(answer)) return cancelFlow();
      install = answer;
    }
  }

  // --- git init? ---
  let git = initial.git;
  if (git === undefined) {
    if (initial.yes) {
      git = true;
    } else {
      const answer = await confirm({
        message: "Initialize a git repository?",
        initialValue: true,
      });
      if (isCancel(answer)) return cancelFlow();
      git = answer;
    }
  }

  return {
    targetDir,
    projectName,
    template,
    features: initial.features ?? [],
    overwrite,
    install,
    git,
  };
}

function cancelFlow(): null {
  cancel("Aborted.");
  return null;
}

export function reportStart(template: TemplateId, targetDir: string): void {
  note(
    `Template: ${pc.cyan(template)}\nTarget:   ${pc.cyan(targetDir)}`,
    "Scaffolding",
  );
}

export interface SuccessReport {
  projectName: string;
  targetDir: string;
  installSucceeded: boolean | null;
  gitSucceeded: boolean | null;
  /** Features the project was scaffolded with, for their own next steps. */
  features?: readonly FeatureId[];
}

function quotePosixShellPath(path: string): string {
  const commandPath = path.startsWith("-") ? `./${path}` : path;
  const safePath = /^[A-Za-z0-9_@%+=:,./-]+$/;
  if (safePath.test(commandPath)) return commandPath;
  return `'${commandPath.replaceAll("'", `'\\''`)}'`;
}

function quoteCommandPromptPath(path: string): string {
  const commandPath = path.startsWith("-") ? `.\\${path}` : path;
  if (!commandPath.includes("%")) {
    return /^[A-Za-z0-9_@+=:,./\\-]+$/.test(commandPath)
      ? commandPath
      : `"${commandPath}"`;
  }

  // cmd.exe expands %name% inside quotes. Quoted segments keep the path in one
  // argument while each unquoted ^% produces a literal percent sign.
  return commandPath
    .split("%")
    .map((segment) => `"${segment}"`)
    .join("^%");
}

function quotePowerShellPath(path: string): string {
  return `'${path.replaceAll("'", "''")}'`;
}

export function directoryChangeCommand(
  path: string,
  platform: NodeJS.Platform = process.platform,
  windowsShell: "powershell" | "cmd" = "powershell",
): string {
  if (platform !== "win32") return `cd ${quotePosixShellPath(path)}`;
  if (windowsShell === "cmd") return `pushd ${quoteCommandPromptPath(path)}`;
  return `Set-Location -LiteralPath ${quotePowerShellPath(path)}`;
}

export function reportSuccess(report: SuccessReport): void {
  const lines: string[] = [];
  const relativeTarget = relativeFromCwd(report.targetDir);
  lines.push(`${pc.green("Success!")} Created ${pc.bold(report.projectName)}`);
  lines.push("");
  lines.push("Next steps:");
  if (process.platform === "win32") {
    lines.push(
      `  ${pc.dim("PowerShell:")} ${pc.cyan(directoryChangeCommand(relativeTarget, "win32", "powershell"))}`,
    );
    lines.push(
      `  ${pc.dim("Command Prompt:")} ${pc.cyan(directoryChangeCommand(relativeTarget, "win32", "cmd"))}`,
    );
  } else {
    lines.push(`  ${pc.cyan(directoryChangeCommand(relativeTarget))}`);
  }
  if (report.installSucceeded === null) {
    lines.push(`  ${pc.cyan("npm install")}`);
  } else if (report.installSucceeded === false) {
    lines.push(
      `  ${pc.yellow("npm install")}   ${pc.dim("(install failed — re-run manually)")}`,
    );
  }
  lines.push(`  ${pc.cyan("npm run dev")}`);
  for (const id of report.features ?? []) {
    for (const step of FEATURES[id].nextSteps ?? []) {
      lines.push(`  ${pc.cyan(step)}`);
    }
  }
  lines.push("");
  lines.push(
    `Docs: ${pc.underline("https://yage.dev")}  •  LLM context: ${pc.underline("https://yage.dev/llms.txt")}`,
  );

  if (report.gitSucceeded === false) {
    lines.push("");
    lines.push(pc.dim("(git init failed — repository not initialized)"));
  }

  note(lines.join("\n"), "Done");
  outro(pc.green("Happy hacking!"));
}

export function reportFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  cancel(`Scaffold failed: ${message}`);
}
