import { ServiceKey } from "@yagejs/core";
import type { Save } from "./Save.js";

/** Service key for the Save instance registered by SavePlugin. */
export const SaveServiceKey = new ServiceKey<Save>("save");
