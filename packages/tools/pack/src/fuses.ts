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
 * `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and
 * `EnableNodeCliInspectArguments` are off, which closes the routes that turn
 * the packaged game into a general Node runtime or attach Node's inspector to
 * it; the two archive fuses that are on make the app refuse to start from
 * anything but its own unchanged archive. The extra `file:` privileges are
 * off because the page is served from the game's own scheme, and the main
 * process reads the files itself.
 *
 * No fuse turns off Chromium's `--remote-debugging-port` and
 * `--remote-debugging-pipe` switches, which let another program control the
 * page. `startGame` from `@yagejs/host-electron` refuses to load the game
 * when a packaged app is started with either.
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
