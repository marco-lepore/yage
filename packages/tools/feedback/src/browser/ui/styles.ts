export const CSS = `
.yage-feedback-launch {position:fixed;right:18px;bottom:18px;z-index:10000;display:flex;flex-wrap:wrap;justify-content:flex-end;max-width:calc(100vw - 36px);gap:6px;opacity:.4;transition:opacity .15s}
.yage-feedback-launch:hover,.yage-feedback-launch:focus-within {opacity:1}
.yage-feedback-launch button {padding:8px 12px;border:1px solid #87a8ff;border-radius:8px;background:#203665;color:white;font:14px system-ui;cursor:pointer}
@media(hover:none){.yage-feedback-launch{opacity:1}}
.yage-feedback {box-sizing:border-box;width:min(1120px,96vw);max-height:94vh;padding:20px;border:1px solid #536789;border-radius:14px;background:#111c30;color:#edf3ff;font:14px/1.5 system-ui;overflow:auto}
.yage-feedback::backdrop {background:#030813cc}
.yage-feedback * {box-sizing:border-box}
.yage-feedback h2 {margin:0;font-size:22px}.yage-feedback p {color:#bac9e2;margin:6px 0 14px}
.yage-feedback button,.yage-feedback select,.yage-feedback textarea {font:inherit;border-radius:6px;border:1px solid #536789;background:#20304b;color:#edf3ff;padding:8px}
.yage-feedback button {cursor:pointer}.yage-feedback button:disabled {opacity:.5;cursor:default}
.yage-feedback header,.yage-feedback nav {display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px}
.yage-feedback .layout {display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px}
.yage-feedback figure {position:relative;margin:0;align-self:start;line-height:0;touch-action:none;user-select:none;background:#000}
.yage-feedback img {display:block;width:100%;height:auto;pointer-events:none}
.yage-feedback .outlines {position:absolute;inset:0;pointer-events:none}
.yage-feedback .outline {position:absolute;border:2px solid #a4c4ff;background:#78a4ff22}
.yage-feedback textarea {width:100%;min-height:100px;resize:vertical}.yage-feedback .targets {margin:8px 0}.yage-feedback label {display:block;padding:3px 0}
.yage-feedback .entity-picker {border:1px solid #536789;border-radius:6px;background:#20304b}
.yage-feedback .entity-picker summary {padding:8px;cursor:pointer}
.yage-feedback .entity-picker fieldset {border:0;margin:0;padding:8px;min-width:0}
.yage-feedback .entity-picker input[type="search"] {width:100%;padding:8px;font:inherit;color:#edf3ff;background:#111c30;border:1px solid #536789;border-radius:4px;margin-bottom:6px}
.yage-feedback .entity-results {max-height:180px;overflow:auto;overflow-wrap:anywhere}
.yage-feedback .entity-paging {display:flex;gap:8px;margin:8px 0}
.yage-feedback .entity-selection {color:#bac9e2;font-size:12px;margin-top:6px;overflow-wrap:anywhere}
.yage-feedback .status {min-height:24px;color:#b5d4ff;white-space:pre-wrap}.yage-feedback .history {max-height:150px;overflow:auto;padding-left:20px}
@media(max-width:760px){.yage-feedback .layout{grid-template-columns:1fr}}
`;
