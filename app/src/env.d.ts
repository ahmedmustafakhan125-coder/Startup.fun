interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'mock' | 'live'
  readonly VITE_API_URL?: string
  readonly VITE_API_PROXY?: string
  readonly VITE_RPC_URL?: string
  readonly VITE_PROGRAM_ID?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
// The generated client in sdk/ reads process.env.NODE_ENV; Vite replaces it at build time.
declare const process: { env: { NODE_ENV?: string } }
