/**
 * The property `mount` writes its API to, for out-of-page drivers.
 *
 * Its own module, with no imports: the CLI names the same property from Node,
 * and taking it from the runner would pull the whole browser shell into the
 * command's bundle.
 */
export const LAB_GLOBAL = "__yageLab__";
