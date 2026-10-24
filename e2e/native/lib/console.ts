/** The prefix the fixture's test profile writes before each report line. */
export const REPORT_PREFIX = "[yage-baseline]";

/**
 * The report object a line carries, or `null` for a line without the prefix.
 * Accepts a browser console line (`[yage-baseline] {...}`) and a line a
 * mobile host forwarded through its own log
 * (`⚡️  [info] - [yage-baseline] {...}`).
 */
export function parseReportLine(line: string): Record<string, unknown> | null {
  const at = line.indexOf(REPORT_PREFIX);
  if (at === -1) return null;
  const json = line.slice(at + REPORT_PREFIX.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(
      `parseReportLine: malformed report line, got ` +
        `${JSON.stringify(line.slice(0, 200))}.`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `parseReportLine: malformed report line, got ` +
        `${JSON.stringify(line.slice(0, 200))}.`,
    );
  }
  return parsed as Record<string, unknown>;
}
