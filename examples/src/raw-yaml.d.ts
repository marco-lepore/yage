// Vite serves a file imported with the `?raw` suffix as its text content. Type
// the dialogue data files the dialogue-addon example loads this way: `.yaml`
// (parsed by `loadYaml`) and `.dlg` compact-DSL scripts (parsed by `loadCompact`).
declare module "*.yaml?raw" {
  const content: string;
  export default content;
}

declare module "*.dlg?raw" {
  const content: string;
  export default content;
}
