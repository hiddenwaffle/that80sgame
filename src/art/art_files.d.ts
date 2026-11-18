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
