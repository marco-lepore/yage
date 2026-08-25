import { defineEvent } from "@yagejs/core";
import type { FeelPlaybackHandle } from "./types.js";

export const FeelStartedEvent = defineEvent<{
  cue: string;
  playback: FeelPlaybackHandle;
}>("feel:started");

export const FeelCompletedEvent = defineEvent<{
  cue: string;
  playback: FeelPlaybackHandle;
}>("feel:completed");

export const FeelStoppedEvent = defineEvent<{
  cue: string;
  playback: FeelPlaybackHandle;
}>("feel:stopped");
