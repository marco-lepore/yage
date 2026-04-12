/**
 * Template registry. When adding a new template, create a directory under
 * `templates/<id>/` with `_package.json` + source files, then add an entry
 * here so it shows up in the CLI's template prompt.
 */

export type TemplateId = "recommended" | "minimal";

export interface TemplateInfo {
  id: TemplateId;
  label: string;
  hint: string;
}

export const TEMPLATES: readonly TemplateInfo[] = [
  {
    id: "recommended",
    label: "Recommended",
    hint: "Playable platformer seed — core, renderer, physics, input, audio, debug",
  },
  {
    id: "minimal",
    label: "Minimal",
    hint: "Empty scene — core, renderer only. Wire the rest yourself.",
  },
] as const;

export const DEFAULT_TEMPLATE: TemplateId = "recommended";

export function isTemplateId(value: string): value is TemplateId {
  return TEMPLATES.some((t) => t.id === value);
}
