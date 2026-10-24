/**
 * Whether the page lets scripts turn strings into code. A content security
 * policy whose `script-src` omits `'unsafe-eval'` forbids it, and the attempt
 * below is the only way to read that: the policy itself is not readable from
 * the page. The attempt writes nothing to the console.
 */
export function stringEvaluationAllowed(): boolean {
  try {
    return new Function("return true")() === true;
  } catch {
    return false;
  }
}
