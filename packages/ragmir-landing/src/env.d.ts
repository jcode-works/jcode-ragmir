/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_RAGMIR_LANDING_URL: string
  readonly PUBLIC_RAGMIR_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
