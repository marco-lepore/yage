import { mount } from "@yagejs-tools/lab/runner";
import harness from "../../lab/harness.js";

// The pattern has to be a literal Vite can analyse statically, so the page
// declares its own glob and the root that scenario ids are derived against.
const modules = import.meta.glob("/src/lab/**/*.scenario.ts", { eager: true });

const host = document.getElementById("lab");
if (!host) throw new Error("#lab is missing from lab.html");

await mount({ harness, modules, root: "/src/lab", host });
