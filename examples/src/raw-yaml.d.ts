// Vite serves a file imported with the `?raw` suffix as its text content. Type
// the YAML dialogue data files the dialogue-addon example loads this way.
declare module "*.yaml?raw" {
  const content: string;
  export default content;
}
