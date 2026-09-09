/** Physical KeyboardEvent.code plus exact modifiers; omitted modifiers are false. */
export interface FeedbackShortcut {
  code: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}
export interface FeedbackShortcuts {
  /** Omitted bindings retain their defaults; false disables this action's key. */
  feedback?: FeedbackShortcut | false;
  freeze?: FeedbackShortcut | false;
  stepFrame?: FeedbackShortcut | false;
  stepTenFrames?: FeedbackShortcut | false;
}
export const shortcutActions = [
  "feedback",
  "freeze",
  "stepFrame",
  "stepTenFrames",
] as const;
export type ResolvedFeedbackShortcuts = Record<
  keyof FeedbackShortcuts,
  Required<FeedbackShortcut> | false
>;

/** Validates before mounting UI and copies caller-owned configuration. */
export function resolveShortcuts(
  options: boolean | FeedbackShortcuts = true,
): ResolvedFeedbackShortcuts {
  if (
    typeof options !== "boolean" &&
    (!options || typeof options !== "object" || Array.isArray(options))
  )
    throw new Error(
      "Feedback shortcuts must be a boolean or a bindings object.",
    );
  if (typeof options === "object") {
    for (const key of Object.keys(options))
      if (!shortcutActions.some((action) => action === key))
        throw new Error(`Unknown feedback shortcut action: ${key}.`);
  }
  const resolve = (
    action: keyof FeedbackShortcuts,
    code: string,
    shift = false,
  ): Required<FeedbackShortcut> | false => {
    const configured =
      typeof options === "object" ? options[action] : undefined;
    const binding =
      options === false
        ? false
        : configured === undefined
          ? { code, shift }
          : configured;
    if (binding === false) return false;
    if (
      !binding ||
      typeof binding !== "object" ||
      typeof binding.code !== "string" ||
      !/^[A-Za-z][A-Za-z0-9]*$/.test(binding.code) ||
      /^(?:Shift|Control|Alt|Meta)(?:Left|Right)$/.test(binding.code)
    )
      throw new Error(
        `Feedback shortcuts.${action}: provide a non-modifier KeyboardEvent.code.`,
      );
    for (const key of Object.keys(binding))
      if (!["code", "ctrl", "alt", "shift", "meta"].includes(key))
        throw new Error(`Feedback shortcuts.${action}: unknown option ${key}.`);
    for (const modifier of ["ctrl", "alt", "shift", "meta"] as const)
      if (
        binding[modifier] !== undefined &&
        typeof binding[modifier] !== "boolean"
      )
        throw new Error(
          `Feedback shortcuts.${action}.${modifier} must be a boolean.`,
        );
    return {
      code: binding.code,
      ctrl: binding.ctrl ?? false,
      alt: binding.alt ?? false,
      shift: binding.shift ?? false,
      meta: binding.meta ?? false,
    };
  };
  const result: ResolvedFeedbackShortcuts = {
    feedback: resolve("feedback", "F8"),
    freeze: resolve("freeze", "F9"),
    stepFrame: resolve("stepFrame", "F10"),
    stepTenFrames: resolve("stepTenFrames", "F10", true),
  };
  const used = new Set<string>();
  for (const action of shortcutActions) {
    const binding = result[action];
    if (!binding) continue;
    const identity = JSON.stringify(binding);
    if (used.has(identity))
      throw new Error("Feedback shortcuts must use different bindings.");
    used.add(identity);
  }
  return result;
}

export function shortcutLabel(
  binding: Required<FeedbackShortcut> | false,
): string {
  return binding
    ? [
        binding.ctrl && "Ctrl",
        binding.alt && "Alt",
        binding.shift && "Shift",
        binding.meta && "Meta",
        binding.code.replace(/^(Key|Digit)(?=.)/, ""),
      ]
        .filter(Boolean)
        .join("+")
    : "";
}
