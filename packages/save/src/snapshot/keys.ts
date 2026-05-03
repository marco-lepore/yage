import { ServiceKey } from "@yagejs/core";
import type { SnapshotService } from "./SnapshotService.js";

/** Service key for the SnapshotService. */
export const SnapshotServiceKey = new ServiceKey<SnapshotService>(
  "snapshotService",
);
