import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";

/** A served web directory. */
export interface ServedDirectory {
  /** Where the directory is reachable, with no trailing slash. */
  readonly url: string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};

/**
 * Serve one built web directory over loopback on a port the system picks, so
 * a browser run loads the same files a shell would.
 */
export async function serveDirectory(dir: string): Promise<ServedDirectory> {
  const root = resolve(dir);
  const server = createServer((request, response) => {
    const path = decodeRequestPath(request.url ?? "/");
    if (path === null) {
      response.writeHead(400).end();
      return;
    }
    const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    void sendFile(file, response);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("serveDirectory: the server reported no port.");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((done, fail) =>
        server.close((error) => (error ? fail(error) : done())),
      ),
  };
}

function decodeRequestPath(url: string): string | null {
  try {
    return normalize(decodeURIComponent(new URL(url, "http://x").pathname));
  } catch {
    return null;
  }
}

async function sendFile(file: string, response: ServerResponse): Promise<void> {
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Length": info.size,
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}

/** The page a served directory's root resolves to. */
export function indexUrl(served: ServedDirectory, query = ""): string {
  return `${served.url}/index.html${query}`;
}
