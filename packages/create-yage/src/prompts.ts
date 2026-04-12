import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import pc from "picocolors";
import type { TemplateId } from "./templates.js";
import { DEFAULT_TEMPLATE, TEMPLATES } from "./templates.js";
import type { DirectoryState } from "./utils.js";
import { deriveProjectName, validateProjectName } from "./utils.js";

export interface ResolvedOptions {
  targetDir: string;
  projectName: string;
  template: TemplateId;
  overwrite: boolean;
  install: boolean;
  git: boolean;
}

export interface PartialOptions {
  targetDirArg?: string;
  template?: TemplateId;
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
  if (dirState.kind === "non-empty" && !overwrite) {
    if (initial.yes) {
      cancel(
        `Target directory is not empty: ${targetDir}. Pass --force to overwrite.`,
      );
      return null;
    }
    const choice = await select<"abort" | "overwrite">({
      message: `${targetDir} is not empty. What do you want to do?`,
      options: [
        { value: "abort", label: "Abort", hint: "Exit without changes" },
        {
          value: "overwrite",
          label: "Overwrite",
          hint: "Delete existing contents and scaffold fresh",
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

  return { targetDir, projectName, template, overwrite, install, git };
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

export function createScaffoldSpinner(): ReturnType<typeof spinner> {
  return spinner();
}

export interface SuccessReport {
  projectName: string;
  targetDir: string;
  installSucceeded: boolean | null;
  gitSucceeded: boolean | null;
}

export function reportSuccess(report: SuccessReport): void {
  const lines: string[] = [];
  const relDir = report.targetDir;
  lines.push(`${pc.green("Success!")} Created ${pc.bold(report.projectName)}`);
  lines.push("");
  lines.push("Next steps:");
  lines.push(`  ${pc.cyan(`cd ${relDir}`)}`);
  if (report.installSucceeded === null) {
    lines.push(`  ${pc.cyan("npm install")}`);
  } else if (report.installSucceeded === false) {
    lines.push(
      `  ${pc.yellow("npm install")}   ${pc.dim("(install failed — re-run manually)")}`,
    );
  }
  lines.push(`  ${pc.cyan("npm run dev")}`);
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
