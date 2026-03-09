import type { DebugContributor, DebugRegistry } from "./types.js";

/** Concrete implementation of the DebugRegistry interface. */
export class DebugRegistryImpl implements DebugRegistry {
  readonly contributors = new Map<string, DebugContributor>();
  enabled = false;
  private flags = new Map<string, boolean>();

  register(contributor: DebugContributor): void {
    if (this.contributors.has(contributor.name)) return;
    this.contributors.set(contributor.name, contributor);
    for (const flag of contributor.flags) {
      this.flags.set(`${contributor.name}.${flag}`, true);
    }
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
