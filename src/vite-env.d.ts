/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
