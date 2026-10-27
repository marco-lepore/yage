import type { CheckReport } from "./types.js";

/**
 * One report as a person reads it: a header, one line per rule, and the fix
 * indented under each failure.
 */
export function reportText(report: CheckReport): string {
  const lines = [`yage-pack ${report.command} — ${report.target}`];
  for (const result of report.results) {
    lines.push(
      `${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`,
    );
    if (!result.ok && result.fix !== null) {
      result.fix
        .split("\n")
        .forEach((line, index) =>
          lines.push(index === 0 ? `  Fix: ${line}` : `       ${line}`),
        );
    }
  }
  return lines.join("\n");
}
