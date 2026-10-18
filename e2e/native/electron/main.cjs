const {
  app,
  BrowserWindow,
  net,
  powerMonitor,
  protocol,
  session,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

/** Read an environment value that must name an existing directory. */
function requireDirectory(name) {
  const value = process.env[name];
  if (!value || !fs.existsSync(value) || !fs.statSync(value).isDirectory()) {
    const label = name === "YAGE_BASELINE_WEB" ? "a built web" : "a profile";
    console.error(
      `Baseline shell: ${name} must name ${label} directory, got ` +
        `${JSON.stringify(value ?? null)}.`,
    );
    app.exit(1);
    return null;
  }
  return path.resolve(value);
}

const root = requireDirectory("YAGE_BASELINE_WEB");
const userData = requireDirectory("YAGE_BASELINE_USER_DATA");
const query = process.env.YAGE_BASELINE_QUERY ?? "";

/** One line per shell event, so a driver reads what the window did. */
function report(event, data = {}) {
  console.log(
    `[yage-shell] ${JSON.stringify({ at: Date.now(), event, ...data })}`,
  );
}

if (root && userData) {
  app.setName("YAGE Baseline");
  app.setPath("userData", userData);

  protocol.registerSchemesAsPrivileged([
    {
      scheme: "yage",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);

  app
    .whenReady()
    .then(async () => {
      report("ready");
      protocol.handle("yage", async (request) => {
        const url = new URL(request.url);
        if (url.host !== "fixture" || request.method !== "GET") {
          return new Response(null, { status: 404 });
        }
        let pathname;
        try {
          pathname = decodeURIComponent(url.pathname);
        } catch {
          return new Response(null, { status: 400 });
        }
        const file = path.resolve(
          root,
          `.${pathname === "/" ? "/index.html" : pathname}`,
        );
        if (!file.startsWith(root + path.sep)) {
          return new Response(null, { status: 403 });
        }
        try {
          return await net.fetch(pathToFileURL(file).href);
        } catch {
          return new Response(null, { status: 404 });
        }
      });
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.webRequest.onHeadersReceived(
        (details, callback) => {
          // Pixi generates renderer code with Function(); bundled Yoga WASM
          // uses a data: fetch.
          callback({
            responseHeaders: {
              ...details.responseHeaders,
              "Content-Security-Policy": [
                "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' data:; object-src 'none'; base-uri 'none'",
              ],
            },
          });
        },
      );

      const win = new BrowserWindow({
        width: 1280,
        height: 720,
        show: false,
        backgroundColor: "#111111",
        title: "YAGE Baseline",
        webPreferences: {
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());

      for (const event of [
        "did-finish-load",
        "render-process-gone",
        "unresponsive",
        "responsive",
      ]) {
        win.webContents.on(event, (...args) => {
          report(event, { detail: describe(args) });
        });
      }
      win.webContents.on(
        "did-fail-load",
        (_event, errorCode, errorDescription, validatedURL) => {
          report("did-fail-load", {
            errorCode,
            errorDescription,
            validatedURL,
          });
        },
      );
      app.on("child-process-gone", (_event, details) => {
        report("child-process-gone", {
          type: details.type,
          reason: details.reason,
        });
      });
      for (const event of [
        "blur",
        "focus",
        "minimize",
        "restore",
        "hide",
        "show",
        "enter-full-screen",
        "leave-full-screen",
      ]) {
        win.on(event, () => report(event));
      }
      for (const event of ["did-become-active", "did-resign-active"]) {
        app.on(event, () => report(event));
      }
      for (const event of [
        "suspend",
        "resume",
        "lock-screen",
        "unlock-screen",
      ]) {
        powerMonitor.on(event, () => report(event));
      }

      win.once("ready-to-show", () => {
        win.show();
        win.focus();
        if (process.platform === "darwin") app.focus({ steal: true });
      });
      await win.loadURL(`yage://fixture/index.html${query}`);
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}

/** A short, serialisable description of an event's extra arguments. */
function describe(args) {
  const detail = args
    .slice(1)
    .map((value) =>
      value && typeof value === "object"
        ? JSON.stringify(value)
        : String(value),
    )
    .join(" ");
  return detail === "" ? null : detail;
}

app.on("window-all-closed", () => app.quit());
