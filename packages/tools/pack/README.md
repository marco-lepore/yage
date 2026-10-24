# @yagejs-tools/pack

Package a [YAGE](https://yage.dev) game for desktop with Electron Forge and
for mobile with Capacitor.

The vendor commands do the building. This tool adds the four things they do
not do: it sets the project up once, checks that this machine can build each
target, checks that the app's identity and YAGE's settings agree across both
hosts, and records what went into a build.

```sh
npm install --save-dev @yagejs-tools/pack
npx yage-pack init --target electron --app-id com.example.mygame
```

## What a game runs

```sh
npx yage-pack doctor            # what this machine is missing, and how to fix it
npm run start:electron          # the game in a desktop window
npm run make:electron           # the app, the files the configured makers write, and a build record
npm run sync:capacitor          # the mobile build into the native projects
npx yage-pack check --target ios --release   # what an iOS release still needs
```

## What it writes

`yage-pack init` writes the entry file each target boots from, the Electron
shell, and two one-line configuration files:

```js
// forge.config.cjs
const { electronForgeConfig } = require("@yagejs-tools/pack/forge");

module.exports = electronForgeConfig();
```

```ts
// capacitor.config.ts
import { capacitorConfig } from "@yagejs-tools/pack/capacitor";

export default capacitorConfig();
```

Both read the app's name, version and identifier from the game's
`package.json`, so the desktop and mobile builds can never disagree about
them. Each entry file passes the host adapter and the host's save adapter to
the game's `boot` function, so desktop and mobile saves are files in the
app's data directory. Everything `init` writes is yours afterwards: it keeps
a file that is already there.

Full reference: [yage.dev/tooling/packaging](https://yage.dev/tooling/packaging).

## License

MIT
