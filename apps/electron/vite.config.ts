import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { fileViewerRenderers } from '@file-viewer/vite-plugin'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: resolve(here, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(here, 'dist/renderer'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@markup/host-api': resolve(here, '../../packages/host-api/src/index.ts'),
      '@markup/core': resolve(here, '../../packages/core/src/index.ts'),
      '@markup/ui': resolve(here, '../../packages/ui/src/index.ts'),
    },
  },
  plugins: [
    // Serves/copies the Full package's worker/WASM/font assets under
    // `file-viewer/` in both dev and build (```file embed previews).
    fileViewerRenderers({ copyAssets: true }),
  ],
})