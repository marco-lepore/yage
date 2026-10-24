/** One packed package of this repository. */
export interface LocalTarball {
  readonly name: string;
  readonly version: string;
  /** Absolute path of the tarball. */
  readonly file: string;
  readonly integrity: string | null;
}

export declare function readLocalPackages(): Map<string, string>;

export declare function packLocalPackages(options: {
  readonly names: readonly string[];
  readonly destination: string;
}): Map<string, LocalTarball>;

export declare function pointAtTarballs(
  manifest: Record<string, unknown>,
  tarballs: Map<string, LocalTarball>,
): Record<string, string>;
