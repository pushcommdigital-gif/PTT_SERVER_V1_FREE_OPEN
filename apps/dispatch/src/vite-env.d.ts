/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base map raster tile URL template. See MapPanel for the usage-policy note. */
  readonly VITE_MAP_TILE_URL?: string;
  /** Attribution HTML shown on the map. Required by the tile/data licence. */
  readonly VITE_MAP_TILE_ATTRIBUTION?: string;
  readonly VITE_DEV_API_TARGET?: string;
  readonly VITE_DEV_TILE_TARGET?: string;
  readonly VITE_DEV_LIVEKIT_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
