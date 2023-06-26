import {
  utils,
  ExtensionType,
  LoaderParserPriority,
  copySearchParams,
} from "pixi.js";

type TilesetReference = {
  firstgid: string;
  source: string;
  data?: any;
};

const tilesetMapAsset = {
  extension: ExtensionType.Asset,
  loader: {
    extension: {
      type: ExtensionType.LoadParser,
      priority: LoaderParserPriority.High,
    },
    async testParse(asset, options) {
      return (
        utils.path.extname(options.src).toLowerCase() === ".json" &&
        asset.tilesets &&
        asset.layers
      );
    },
    async parse(asset, options, loader) {
      let basePath = utils.path.dirname(options.src);
      if (basePath && basePath.lastIndexOf("/") !== basePath.length - 1) {
        basePath += "/";
      }

      for (const tileset of asset.tilesets as TilesetReference[]) {
        let path = basePath + tileset.source;
        path = copySearchParams(path, options.src);
        const tilesetData = (await loader.load([path]))[path];
        tileset.data = tilesetData;
      }
      return asset;
    },
    unload(asset) {},
  },
};

export { tilesetMapAsset };
