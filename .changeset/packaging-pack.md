---
"@yagejs-tools/pack": minor
---

Package YAGE games with Electron Forge and Capacitor.

- New package. `yage-pack init --target <electron|ios|android>…` writes the entry file each target boots from, the Electron shell, `forge.config.cjs` and `capacitor.config.ts`, adds the build and packaging scripts, and sets `productName`, `yage.appId` and `main` when they are absent. It keeps every file that is already there unless `--force` is passed, so the files are the game's after the first run.
- `yage-pack doctor` reports what each target's build needs and installs nothing: Node, the packages and peer versions the host adapters accept, one copy of `pixi.js`, and then Xcode and a simulator runtime, or a JDK and the Android SDK. Each failure carries the exact command or setting that fixes it.
- `yage-pack check` compares the app's identity across both hosts and checks the settings the mobile adapter depends on, so it gates every `npx cap sync` through the sync hook and every Electron package. With `--release` it also refuses a development server, a keystore password in the configuration, a version that differs from `package.json`, an iOS app without a privacy manifest, an Android app that does not declare itself a game, and a package whose fuses or archive differ from the release set. It writes nothing.
- `yage-pack record` writes a JSON `BuildRecord`: the app's identity, the git commit and the files that differed from it, every installed package and resolved dependency version, the toolchain, the hash of every file in the web build, and each artifact's kind, size, hash and signing state.
- `electronForgeConfig()` from `@yagejs-tools/pack/forge` is what `forge.config.cjs` exports. It owns the archive, the bundle identifier and what goes into the package, adds the seven release fuses, runs the checks before and after packaging and writes the build record. Packager settings, makers, plugins and hooks the game passes are kept, and its hooks run after YAGE's.
- `capacitorConfig()` from `@yagejs-tools/pack/capacitor` is what `capacitor.config.ts` exports. It sets the app's identity, the web directory and `ios.contentInset: "never"`, and keeps the Android Back button reaching the game. Overriding one of those throws at config load; everything else passes through.
- `hashDirectory()` and `REQUIRED_PACKAGES` are exported from the root entry, along with the `BuildRecord`, `BuildArtifact`, `CheckReport` and `CheckResult` types.
- The input is one web build per target, read from `dist-electron/` and `dist-capacitor/`. The browser build in `dist/` is untouched.
