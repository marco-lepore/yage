import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  directoryChangeCommand,
  reportSuccess,
  runPrompts,
} from "./prompts.js";

const promptMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  isCancel: vi.fn(() => false),
  note: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock("@clack/prompts", () => promptMocks);
vi.mock("picocolors", () => ({
  default: {
    bgMagenta: (value: string) => value,
    black: (value: string) => value,
    bold: (value: string) => value,
    cyan: (value: string) => value,
    dim: (value: string) => value,
    green: (value: string) => value,
    underline: (value: string) => value,
    yellow: (value: string) => value,
  },
}));

describe("runPrompts target collisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    promptMocks.isCancel.mockReturnValue(false);
  });

  it("names an existing file in non-interactive mode", async () => {
    const result = await runPrompts(
      {
        targetDirArg: "game",
        template: "minimal",
        install: false,
        git: false,
        yes: true,
      },
      {
        inspectTarget: () => ({ kind: "file" }),
        resolveTarget: (target) => target,
      },
    );

    expect(result).toBeNull();
    expect(promptMocks.cancel).toHaveBeenCalledWith(
      "Target path is a file: game. Pass --force to overwrite.",
    );
  });

  it("states that directory overwrite preserves .git", async () => {
    promptMocks.select.mockResolvedValue("overwrite");

    const result = await runPrompts(
      {
        targetDirArg: "game",
        template: "minimal",
        install: false,
        git: false,
      },
      {
        inspectTarget: () => ({ kind: "non-empty", entries: ["old.txt"] }),
        resolveTarget: (target) => target,
      },
    );

    expect(result?.overwrite).toBe(true);
    expect(promptMocks.select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({
            value: "overwrite",
            hint: "Remove existing contents except .git and scaffold the project",
          }),
        ]),
      }),
    );
  });
});

describe("reportSuccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prints the target path relative to the current directory", () => {
    const targetDir = join(process.cwd(), "nested", "game");

    reportSuccess({
      projectName: "game",
      targetDir,
      installSucceeded: true,
      gitSucceeded: true,
    });

    expect(promptMocks.note).toHaveBeenCalledWith(
      expect.stringContaining(`cd ${relative(process.cwd(), targetDir)}`),
      "Done",
    );
  });

  it("quotes a target path that contains spaces", () => {
    const targetDir = join(process.cwd(), "nested dir", "my game");

    reportSuccess({
      projectName: "my-game",
      targetDir,
      installSucceeded: true,
      gitSucceeded: true,
    });

    const relativeTarget = relative(process.cwd(), targetDir);
    const expected =
      process.platform === "win32"
        ? `cd "${relativeTarget}"`
        : `cd '${relativeTarget}'`;
    expect(promptMocks.note).toHaveBeenCalledWith(
      expect.stringContaining(expected),
      "Done",
    );
  });

  it("prefixes a target path that starts with a dash", () => {
    const targetDir = join(process.cwd(), "-game");

    reportSuccess({
      projectName: "game",
      targetDir,
      installSucceeded: true,
      gitSucceeded: true,
    });

    const expected =
      process.platform === "win32" ? "cd .\\-game" : "cd ./-game";
    expect(promptMocks.note).toHaveBeenCalledWith(
      expect.stringContaining(expected),
      "Done",
    );
  });

  it("uses a cross-drive directory command on Windows", () => {
    expect(directoryChangeCommand("D:\\games\\yage", "win32", "cmd")).toBe(
      "pushd D:\\games\\yage",
    );
    expect(directoryChangeCommand("D:\\my games\\yage", "win32", "cmd")).toBe(
      'pushd "D:\\my games\\yage"',
    );
  });

  it("preserves percent signs in Windows shell paths", () => {
    const path = "D:\\my games\\100%complete%game";

    expect(directoryChangeCommand(path, "win32", "cmd")).toBe(
      'pushd "D:\\my games\\100"^%"complete"^%"game"',
    );
    expect(directoryChangeCommand(path, "win32", "powershell")).toBe(
      "Set-Location -LiteralPath 'D:\\my games\\100%complete%game'",
    );
  });
});
