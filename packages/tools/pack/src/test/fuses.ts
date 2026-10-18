import { RELEASE_FUSES, type FuseName } from "../fuses.js";
import { addFile } from "./tree.js";

/** The index each fuse name has on the wire. */
const INDEX: Readonly<Record<FuseName, number>> = {
  RunAsNode: 0,
  EnableCookieEncryption: 1,
  EnableNodeOptionsEnvironmentVariable: 2,
  EnableNodeCliInspectArguments: 3,
  EnableEmbeddedAsarIntegrityValidation: 4,
  OnlyLoadAppFromAsar: 5,
  GrantFileProtocolExtraPrivileges: 7,
};

/** A fuse wire matching the release set apart from the named flips. */
export function wire(
  flipped: Partial<Record<FuseName, boolean>> = {},
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [name, wanted] of Object.entries(RELEASE_FUSES)) {
    const on = flipped[name as FuseName] ?? wanted;
    out[INDEX[name as FuseName]] = on ? 49 : 48;
  }
  return out;
}

/**
 * Install a stand-in for the fuse reader in a test game, so a check reads a
 * wire a test chose instead of a packaged binary.
 */
export function installFuseReader(
  root: string,
  answer: Record<number, number> | "missing",
): void {
  addFile(
    root,
    "node_modules/@electron/fuses/package.json",
    JSON.stringify({
      name: "@electron/fuses",
      version: "2.1.3",
      main: "index.cjs",
    }),
  );
  const body =
    answer === "missing"
      ? "Promise.reject(new Error('no fuse wire'))"
      : `Promise.resolve(${JSON.stringify(answer)})`;
  addFile(
    root,
    "node_modules/@electron/fuses/index.cjs",
    `module.exports = {
  FuseVersion: { V1: "1" },
  FuseV1Options: ${JSON.stringify(INDEX)},
  FuseState: { DISABLE: 48, ENABLE: 49 },
  getCurrentFuseWire: () => ${body},
};
`,
  );
}

/** A stand-in for the Forge plugin that records the fuses it was given. */
export function installFusesPlugin(root: string): void {
  addFile(
    root,
    "node_modules/@electron-forge/plugin-fuses/package.json",
    JSON.stringify({
      name: "@electron-forge/plugin-fuses",
      version: "8.0.1",
      main: "index.cjs",
    }),
  );
  addFile(
    root,
    "node_modules/@electron-forge/plugin-fuses/index.cjs",
    `class FusesPlugin {
  constructor(config) {
    this.name = "fuses";
    this.config = config;
  }
}
module.exports = { FusesPlugin };
`,
  );
}
