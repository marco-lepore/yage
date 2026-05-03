import type { SnapshotStorage } from "./types.js";

/** In-memory SnapshotStorage for testing. */
export class MemoryStorage implements SnapshotStorage {
  private data = new Map<string, string>();

  load(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  save(key: string, data: string): void {
    this.data.set(key, data);
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  list(prefix?: string): string[] {
    if (!prefix) return [...this.data.keys()];
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}
