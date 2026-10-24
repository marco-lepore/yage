import { contextBridge, ipcRenderer } from "electron";
import { createBridge } from "./createBridge.js";

contextBridge.exposeInMainWorld("__yageHost__", createBridge(ipcRenderer));
