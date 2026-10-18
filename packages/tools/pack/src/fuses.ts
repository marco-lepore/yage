/** The fuse names a release build sets. */
export type FuseName =
  | "RunAsNode"
  | "EnableCookieEncryption"
  | "EnableNodeOptionsEnvironmentVariable"
  | "EnableNodeCliInspectArguments"
  | "EnableEmbeddedAsarIntegrityValidation"
  | "OnlyLoadAppFromAsar"
  | "GrantFileProtocolExtraPrivileges";

/**
 * The fuses every Forge package of a YAGE game carries.
 *
 * The four that are off close the routes that turn the packaged game into a
 * general Node runtime or attach a debugger to it; the two that are on make
 * the app refuse to start from anything but its own unchanged archive. The
 * extra `file:` privileges are off because the page is served from the
 * game's own scheme, and the main process reads the files itself.
 *
 * `EnableNodeCliInspectArguments` being off also keeps a test driver from
 * attaching to a packaged app: a packaged app is checked by running it and
 * reading what it writes.
 */
export const RELEASE_FUSES: Readonly<Record<FuseName, boolean>> = Object.freeze(
  {
    RunAsNode: false,
    EnableCookieEncryption: true,
    EnableNodeOptionsEnvironmentVariable: false,
    EnableNodeCliInspectArguments: false,
    EnableEmbeddedAsarIntegrityValidation: true,
    OnlyLoadAppFromAsar: true,
    GrantFileProtocolExtraPrivileges: false,
  },
);
