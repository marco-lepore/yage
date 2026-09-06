import { readLevel } from "./document/read.js";
import type { LevelDocument } from "./document/types.js";

/**
 * Read a level document from a URL.
 *
 * What every game does to open a level: fetch it, check that what came back is
 * one, and fail with something a developer can act on. The failure names the
 * URL, because a game that loads several levels reports one message for all of
 * them.
 *
 * Never cached. A level being edited changes under the page, and a reload that
 * showed the previous one would look like an editor that had lost the change.
 */
export async function loadLevelDocument(url: string): Promise<LevelDocument> {
  const response = await fetched(url);
  if (!response.ok) {
    throw new Error(
      `${url} answered ${String(response.status)} ${response.statusText}.`,
    );
  }
  const source: unknown = await parsed(url, response);
  const structural = readLevel(source);
  if (!structural.ok) {
    const detail = structural.errors
      .map((error) => `${error.path} ${error.message}`)
      .join(", ");
    throw new Error(`${url} is not a readable level: ${detail}`);
  }
  return structural.document;
}

async function fetched(url: string): Promise<Response> {
  try {
    return await fetch(url, { cache: "no-store" });
  } catch (cause) {
    throw new Error(`${url} could not be reached.`, { cause });
  }
}

async function parsed(url: string, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`${url} did not answer with JSON.`, { cause });
  }
}
