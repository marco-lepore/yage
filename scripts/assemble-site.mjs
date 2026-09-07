/**
 * Assembles the deploy directory for the yage.dev Cloudflare Pages project.
 *
 * Output layout (dist/site/):
 *   /              → docs (Starlight)
 *   /llms.txt      → LLM index (served by docs build)
 *   /llms-full.txt → LLM full docs (served by docs build)
 *
 * The examples are a Pages project of their own, at examples.yage.dev. They
 * are built with an asset base of `/`, so they only work at a domain root.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = resolve(root, "dist/site");

// Clean previous output
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(resolve(root, "docs/dist"), out, { recursive: true });

console.log("Site assembled at dist/site/");
