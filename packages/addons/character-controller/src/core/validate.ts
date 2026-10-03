export function finite(
  context: string,
  name: string,
  value: number,
  minimum = -Infinity,
): void {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(
      `${context}: ${name} must be finite and >= ${minimum}, got ${value}`,
    );
  }
}

export function tuningNumbers(context: string, tuning: object): void {
  for (const [name, value] of Object.entries(tuning)) {
    if (typeof value === "number") finite(context, name, value, 0);
  }
}
