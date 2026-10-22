import { defineEvent } from "@yagejs/core";
import type { HotbarActivation, HotbarSnapshot } from "./core/types.js";

export const HotbarChangedEvent = defineEvent<HotbarSnapshot>("hotbar:changed");
export const HotbarActivationEvent =
  defineEvent<HotbarActivation>("hotbar:activation");
