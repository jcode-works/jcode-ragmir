/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RAGMIR_LICENSE_PUBLIC_KEY_JWK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
