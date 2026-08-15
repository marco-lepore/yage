import type { Entity } from "@yagejs/core";
import type {
  DebugContributor,
  DebugRegistry,
  DebugVectorOptions,
  DebugVectorProvider,
} from "./types.js";
import { VectorDrawStore } from "./VectorDrawStore.js";

/** Concrete implementation of the DebugRegistry interface. */
export class DebugRegistryImpl implements DebugRegistry {
  readonly contributors = new Map<string, DebugContributor>();
  /** Backs `drawVector`; read by the built-in `vectors` contributor. */
  readonly vectors = new VectorDrawStore();
  enabled = false;
  private flags = new Map<string, boolean>();

  register(contributor: DebugContributor): void {
    if (this.contributors.has(contributor.name)) return;
    this.contributors.set(contributor.name, contributor);
    // Flags default to true on read (`?? true`), so registration must not
    // write them — contributors register after install applies the user's
    // DebugConfig.flags overrides, and a write here would clobber them.
  }

  drawVector(
    entity: Entity,
    vector: DebugVectorProvider,
    options?: DebugVectorOptions,
  ): () => void {
    return this.vectors.add(entity, vector, options);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isFlagEnabled(contributorName: string, flag: string): boolean {
    return this.flags.get(`${contributorName}.${flag}`) ?? true;
  }

  toggle(): void {
    this.enabled = !this.enabled;
  }

  toggleFlag(contributorName: string, flag: string): void {
    const key = `${contributorName}.${flag}`;
    this.flags.set(key, !(this.flags.get(key) ?? true));
  }

  setFlag(contributorName: string, flag: string, value: boolean): void {
    this.flags.set(`${contributorName}.${flag}`, value);
  }
}
