import type { IpcRenderer, IpcRendererEvent } from "electron";
import { CHANNELS, HOST_BRIDGE_PROTOCOL } from "../protocol.js";
import type { BridgeFullscreenResult, BridgeState } from "../protocol.js";
import type { HostBridge } from "../bridge.js";

/** The part of Electron's renderer IPC the bridge uses. */
export type BridgeIpc = Pick<IpcRenderer, "invoke" | "on" | "removeListener">;

/** The bridge object, built over the renderer process's IPC. */
export function createBridge(ipc: BridgeIpc): HostBridge {
  return {
    protocol: HOST_BRIDGE_PROTOCOL,
    start: () => ipc.invoke(CHANNELS.start),
    onState: (listener: (state: BridgeState) => void) => {
      const handler = (_event: IpcRendererEvent, state: BridgeState): void => {
        listener(state);
      };
      ipc.on(CHANNELS.state, handler);
      return () => {
        ipc.removeListener(CHANNELS.state, handler);
      };
    },
    setFullscreen: (active: boolean): Promise<BridgeFullscreenResult> =>
      ipc.invoke(CHANNELS.fullscreen, active),
    saves: {
      read: (key: string): Promise<string | null> =>
        ipc.invoke(CHANNELS.savesRead, key),
      write: (key: string, value: string): Promise<void> =>
        ipc.invoke(CHANNELS.savesWrite, key, value),
      delete: (key: string): Promise<void> =>
        ipc.invoke(CHANNELS.savesDelete, key),
      list: (prefix: string): Promise<string[]> =>
        ipc.invoke(CHANNELS.savesList, prefix),
    },
  };
}
