/**
 * Assembles the final deploy directory for Cloudflare Pages.
 *
 * Output layout (dist/site/):
 *   /              → docs (Starlight)
 *   /examples/     → built examples (Vite MPA)
 *   /llms.txt      → LLM index (served by docs build)
 *   /llms-full.txt → LLM full docs (served by docs build)
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = resolve(root, "dist/site");

// Clean previous output
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. Copy docs as the root
cpSync(resolve(root, "docs/dist"), out, { recursive: true });

// 2. Copy examples under /examples/
cpSync(resolve(root, "examples/dist"), resolve(out, "examples"), { recursive: true });

console.log("Site assembled at dist/site/");
