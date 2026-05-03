import type { SnapshotStorage } from "./types.js";

/** SnapshotStorage backed by browser localStorage. */
export class LocalStorageSnapshotStorage implements SnapshotStorage {
  load(key: string): string | null {
    return localStorage.getItem(key);
  }

  save(key: string, data: string): void {
    localStorage.setItem(key, data);
  }

  delete(key: string): void {
    localStorage.removeItem(key);
  }

  list(prefix?: string): string[] {
    const result: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && (!prefix || key.startsWith(prefix))) {
        result.push(key);
      }
    }
    return result;
  }
}
