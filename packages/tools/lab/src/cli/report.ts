import path from "node:path";
import pc from "picocolors";
import type { LabConfig } from "./labConfig.js";

/**
 * The two things that decide what a run browses: which config it extended and
 * which files it searched. Both are guessed from the project unless the caller
 * says otherwise, so both are worth showing.
 */
export function describeProject(lab: LabConfig): string {
  const config = lab.configFile
    ? path.relative(lab.root, lab.configFile) || lab.configFile
    : "none — using Vite's defaults";
  return (
    `  ${pc.dim("config")}     ${config}\n` +
    `  ${pc.dim("scenarios")}  ${lab.scenarios.join(", ")}\n\n`
  );
}
