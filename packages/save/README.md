# @yage/save

Save and load game state for the [YAGE](https://yage.dev) 2D game engine.

## Install

```bash
npm install @yage/save
```

## Usage

```ts
import { Engine } from "@yage/core";
import { SavePlugin, SaveServiceKey } from "@yage/save";

const engine = new Engine();
engine.use(new SavePlugin());
```

Mark components as serializable and save the world:

```ts
import { serializable } from "@yage/core";

@serializable("player-stats")
class PlayerStats extends Component {
  constructor(public hp = 100, public xp = 0) { super(); }
}

// Save
const saveService = engine.context.resolve(SaveServiceKey);
await saveService.save("slot-1");

// Load
await saveService.load("slot-1");
```

## What's in the box

- **SavePlugin / SaveService** - snapshot the entire engine state
- **Pluggable storage** - `LocalStorageSaveStorage` included; implement `SaveStorage` for custom backends (IndexedDB, files, remote, etc.)
- **@serializable decorator** - opt components into save/load
- **Typed slots** - multiple save slots with metadata

## Docs

Full documentation at [yage.dev](https://yage.dev).

## License

MIT
