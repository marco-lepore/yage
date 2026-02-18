interface YageDebugInfo {
  version: string;
  fps: number;
  entityCount: number;
}

declare global {
  interface Window {
    __yage__?: YageDebugInfo;
  }
}

export {};
