import {
  utils,
  ExtensionType,
  LoaderParserPriority,
  AssetExtension,
  LoaderParser,
} from 'pixi.js'

const midiAsset: AssetExtension<ArrayBuffer> = {
  extension: ExtensionType.Asset,
  detection: {
    test: async () => true,
    add: async (formats: string[]) => [...formats, 'mid'],
    remove: async (formats: string[]) =>
      formats.filter((extension) => extension !== 'mid'),
  },
  loader: {
    name: 'midi',
    extension: {
      type: ExtensionType.LoadParser,
      priority: LoaderParserPriority.High,
    },
    /** Should we attempt to load this file? */
    test(url) {
      const extension = utils.path.extname(url).slice(1)
      return extension === 'mid'
    },
    async load(url) {
      const response = await fetch(url)
      return response.arrayBuffer()
    },
  } as LoaderParser<ArrayBuffer>,
}

export { midiAsset }
