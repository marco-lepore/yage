/**
 * Extensible-channel surface (pixi-free): the optional-hook
 * {@link DialogueExtraChannel} a host registers on a conversation, plus the
 * built-in {@link createVoiceChannel} voice-over channel.
 */
export type { DialogueExtraChannel } from "./types.js";
export { createVoiceChannel } from "./voice.js";
export type { VoiceChannelOptions, VoiceHandle } from "./voice.js";
