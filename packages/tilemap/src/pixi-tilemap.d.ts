declare module "@pixi/tilemap" {
  import { Container, Texture, TextureSource } from "pixi.js";

  export class CompositeTilemap extends Container {
    tileset(textures: TextureSource[]): this;
    tile(
      tileTexture: Texture | TextureSource | string | number,
      x: number,
      y: number,
      options?: {
        u?: number;
        v?: number;
        tileWidth?: number;
        tileHeight?: number;
        animX?: number;
        animY?: number;
        rotate?: number;
        animCountX?: number;
        animCountY?: number;
        animDivisor?: number;
        alpha?: number;
      },
    ): this;
    clear(): this;
  }

  export class Tilemap extends Container {
    tile(
      tileTexture: Texture | TextureSource | string | number,
      x: number,
      y: number,
      options?: Record<string, unknown>,
    ): this;
    clear(): this;
  }
}
