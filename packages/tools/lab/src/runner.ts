/**
 * The browser shell — boots the harness's engine, browses the scenarios found
 * by the glob, and rebuilds the scene when a control changes.
 *
 * Imported by the page that hosts the lab, never by a scenario file.
 */
export {
  mount,
  LAB_GLOBAL,
  type LabApi,
  type MountOptions,
} from "./runner/mountLab.js";

export type { LabClock } from "./runner/LabClock.js";

export type { DriveCapture, DriveResult, RunPace } from "./runner/runDrive.js";

export type { CaptureView, LabCaptureResult } from "./runner/labCapture.js";

export type {
  RegistryProblem,
  ScenarioEntry,
} from "./runner/ScenarioRegistry.js";
