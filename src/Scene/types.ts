import type { Scene } from '.'

export type AnyState = Record<string, unknown> | void
export type AnyEvents = Record<string, CustomEvent<unknown>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyScene = Scene<any, any>
