import { createServer } from "node:http";
import { createFeedbackApplication } from "./application.js";
import type { FeedbackApplicationOptions } from "./application.js";
import { normalizeBasePath } from "../../shared/endpoint.js";

export interface FeedbackServerOptions extends FeedbackApplicationOptions {
  /** Zero lets the OS allocate an available port. */
  port?: number;
}
export interface FeedbackServer {
  readonly url: string;
  /** Stops HTTP and waits for accepted writes before releasing the directory. */
  close(): Promise<void>;
}
export async function startFeedbackServer(
  options: FeedbackServerOptions,
): Promise<FeedbackServer> {
  const port = options.port ?? 5212;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Feedback port must be an integer from 0 to 65535.");
  const app = createFeedbackApplication({
    ...options,
    origins: options.origins ?? [
      "http://127.0.0.1:5213",
      "http://127.0.0.1:5214",
      "http://localhost:5214",
    ],
  });
  const server = createServer(app.handle);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await app.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Feedback server has no TCP address.");
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}${normalizeBasePath(options.basePath ?? "/").replace(/\/$/, "")}`,
    close: () => {
      closing ??= (async () => {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await app.close();
      })();
      return closing;
    },
  };
}
