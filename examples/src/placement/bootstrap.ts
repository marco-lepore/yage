import { Engine, InspectorPlugin, Scene } from "@yagejs/core";
import { InputPlugin } from "@yagejs/input";
import { RendererPlugin } from "@yagejs/renderer";
import { placementControls } from "@yagejs-addons/placement";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import type { RoomView } from "./content.js";
import { RoomEditorEntity } from "./RoomEditor.js";

class RoomScene extends Scene {
  readonly name: string;
  constructor(private readonly view: RoomView) {
    super();
    this.name = view === "topdown" ? "room-workshop" : `${view}-workshop`;
  }
  onEnter(): void {
    this.spawn(RoomEditorEntity, this.view, { key: "room-editor" });
  }
}

export async function startRoomExample(view: RoomView): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(new InspectorPlugin());
  engine.use(
    new RendererPlugin({
      width: 864,
      height: 600,
      backgroundColor: 0x182c26,
      container: setupGameContainer(864, 600),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        ...placementControls(),
        "room-floor": ["KeyF"],
        "room-walls": ["KeyW"],
        "room-finish": ["KeyC"],
        "room-lock": ["KeyP"],
        "room-save": ["KeyS"],
        "room-load": ["KeyL"],
        "room-cascade": ["KeyX"],
      },
      preventDefaultKeys: ["Backspace", "Delete"],
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new RoomScene(view));
}
