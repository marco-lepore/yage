/**
 * Named colors recurring across the examples, extracted so example code reads
 * with intent (`palette.green`) instead of a raw hex. Adopt opportunistically —
 * not every example color needs a name here.
 */
export const palette = {
  white: 0xffffff,
  black: 0x000000,
  ink: 0x0a0a0a, // near-black page background

  // Accents
  green: 0x22c55e,
  red: 0xef4444,
  sky: 0x38bdf8,
  blue: 0x3b82f6,
  amber: 0xfacc15,
  orange: 0xf97316,
  violet: 0xa78bfa,
  coinYellow: 0xffe66d,
  coral: 0xff6b6b,

  // Slate ramp, dark -> light (panels, text, muted UI)
  slate900: 0x0f172a,
  slate800: 0x1e293b,
  slate700: 0x334155,
  slate600: 0x475569,
  slate500: 0x64748b,
  slate400: 0x94a3b8,
} as const;

export type PaletteColor = (typeof palette)[keyof typeof palette];
