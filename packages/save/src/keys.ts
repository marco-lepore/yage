import { ServiceKey } from "@yage/core";
import type { SaveService } from "./SaveService.js";

/** Service key for the SaveService. */
export const SaveServiceKey = new ServiceKey<SaveService>("saveService");
