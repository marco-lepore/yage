import { describe, expect, it } from "vitest";
import {
  editorPagePaths,
  isEditorPage,
  isPlayPage,
  playPagePaths,
  servedPagePaths,
  shadowsOwnPage,
} from "./pages.js";

describe("the editor's own pages", () => {
  it("answers at the server root when there is no base", () => {
    expect(editorPagePaths("/")).toEqual(["/", "/index.html"]);
    expect(playPagePaths("/")).toEqual(["/play", "/play.html"]);
  });

  it("moves under the base the project configured", () => {
    expect(editorPagePaths("/app/")).toEqual(["/app/", "/app/index.html"]);
    expect(playPagePaths("/app/")).toEqual(["/app/play", "/app/play.html"]);
  });

  it("tells its two pages apart", () => {
    expect(isEditorPage("/app/", "/app/")).toBe(true);
    expect(isPlayPage("/app/", "/app/")).toBe(false);
    expect(isPlayPage("/app/play", "/app/")).toBe(true);
    expect(isEditorPage("/app/play", "/app/")).toBe(false);
  });
});

describe("shadowsOwnPage", () => {
  it("refuses a page the editor answers first", () => {
    expect(shadowsOwnPage("/")).toBe(true);
    expect(shadowsOwnPage("/index.html")).toBe(true);
    expect(shadowsOwnPage("/play.html")).toBe(true);
  });

  it("refuses a form the request could arrive in, not just the one written", () => {
    // `/play` is served as `/play.html` by Vite's own fallback, and that is
    // the play page — so a game page written as `/play` is shadowed even
    // though the two strings differ.
    expect(servedPagePaths("/play")).toContain("/play.html");
    expect(shadowsOwnPage("/play")).toBe(true);
  });

  it("leaves an ordinary game page alone", () => {
    expect(shadowsOwnPage("/game.html")).toBe(false);
    expect(shadowsOwnPage("/play/index.html")).toBe(false);
    expect(shadowsOwnPage("/games/play.html")).toBe(false);
  });
});
