declare module 'virtual:art-files' {
  /** Each art image's size in bytes and pixels, keyed exactly as the virtual art source catalog (vite.config.ts). */
  const facts: Record<string, { bytes: number; width: number; height: number }>;
  export default facts;
}

declare module 'virtual:art-sources' {
  /** True for every built catalog, regardless of NODE_ENV. */
  export const webpOnly: boolean;
  /** Each file's address; null in development for a master whose WebP copy is missing or stale (it shows hot pink). */
  const files: Record<string, string | null>;
  export default files;
}

declare module 'virtual:kit-art' {
  /** The images the kit compositions draw from, by slot, with their address (null as for `files`) and size (vite.config.ts). */
  export const kitImages: Record<string, { url: string | null; bytes: number; width: number; height: number }>;
  /** Each map's kit composition (its `kit_art` property), by map id. */
  const arts: Record<string, import('../../tools/kit_art.ts').KitArt>;
  export default arts;
}
