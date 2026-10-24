const { app, BrowserWindow, powerMonitor } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { startGame } = require("@yagejs/host-electron/main");

/** Read an environment value that must name an existing path. */
function requirePath(name, label) {
  const value = process.env[name];
  if (!value || !fs.existsSync(value)) {
    console.error(
      `Baseline shell: ${name} must name ${label}, got ` +
        `${JSON.stringify(value ?? null)}.`,
    );
    app.exit(1);
    return null;
  }
  return path.resolve(value);
}

/** One line per shell event, so a driver reads what the window did. */
function report(event, data = {}) {
  console.log(
    `[yage-shell] ${JSON.stringify({ at: Date.now(), event, ...data })}`,
  );
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

// A packaged copy holds the build beside the shell, so the environment only
// names it when the shell runs unpackaged against a directory of its own.
const webDir =
  process.env.YAGE_BASELINE_WEB === undefined
    ? path.join(__dirname, "..", "dist-electron")
    : requirePath("YAGE_BASELINE_WEB", "a built web directory or archive");
const appData = requirePath("YAGE_BASELINE_APP_DATA", "a profile directory");
const profile = process.env.YAGE_BASELINE_PROFILE ?? "test";
const query = process.env.YAGE_BASELINE_QUERY ?? "";

if (webDir && appData) {
  app.setPath("appData", appData);
  app.setPath("userData", path.join(appData, "YAGE Baseline"));

  app.on("browser-window-created", (_event, win) => {
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
      (_e, errorCode, errorDescription, validatedURL) => {
        report("did-fail-load", { errorCode, errorDescription, validatedURL });
      },
    );
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
  });
  app.on("child-process-gone", (_event, details) => {
    report("child-process-gone", {
      type: details.type,
      reason: details.reason,
    });
  });
  for (const event of ["did-become-active", "did-resign-active"]) {
    app.on(event, () => report(event));
  }
  for (const event of ["suspend", "resume", "lock-screen", "unlock-screen"]) {
    powerMonitor.on(event, () => report(event));
  }
  app.whenReady().then(() => report("ready"));

  startGame({
    webDir,
    appId: "dev.yage.baseline",
    profile,
    devTools: profile !== "release",
    query,
    window: {
      width: 1280,
      height: 720,
      backgroundColor: "#111111",
      title: "YAGE Baseline",
    },
  })
    .then((win) => {
      win.focus();
      if (process.platform === "darwin") app.focus({ steal: true });
      report("started", { windows: BrowserWindow.getAllWindows().length });
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
