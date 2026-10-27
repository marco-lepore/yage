import { net } from "electron";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Serve one file of the built web directory. Every answer carries the
 * content security policy, so a page the shell never meant to serve is still
 * answered under it.
 */
export async function serveGameFile(
  root: string,
  policy: string,
  request: Request,
): Promise<Response> {
  const headers = { "Content-Security-Policy": policy };
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers });
  }
  const url = new URL(request.url);
  if (url.host !== "game") return new Response(null, { status: 404, headers });
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response(null, { status: 400, headers });
  }
  const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(root + sep)) {
    return new Response(null, { status: 403, headers });
  }
  let served: Response;
  try {
    served = await net.fetch(pathToFileURL(file).href);
  } catch {
    return new Response(null, { status: 404, headers });
  }
  const withPolicy = new Headers(served.headers);
  withPolicy.set("Content-Security-Policy", policy);
  return new Response(served.body, {
    status: served.status,
    statusText: served.statusText,
    headers: withPolicy,
  });
}
