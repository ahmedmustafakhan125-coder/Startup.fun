import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build` -> normal static build in dist/
// `npm run build:preview` -> one self-contained index.html in dist-preview/ (used for the shareable preview)
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'preview' ? [viteSingleFile()] : [])],
  // The generated program client lives in ../sdk and is imported as source.
  resolve: { dedupe: ['@solana/kit'] },
  server: {
    fs: { allow: ['..'] },
    // The backend is reached through the dev server, so the browser needs one origin and one port.
    proxy: { '/api': { target: loadEnv(mode, process.cwd(), 'VITE_').VITE_API_PROXY || 'http://127.0.0.1:8787', rewrite: path => path.replace(/^\/api/, '') } },
  },
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production') },
  build: {
    outDir: mode === 'preview' ? 'dist-preview' : 'dist',
    assetsInlineLimit: mode === 'preview' ? 100000000 : 4096,
  },
}))
