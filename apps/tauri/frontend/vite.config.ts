import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { fileViewerRenderers } from '@file-viewer/vite-plugin'

const here = fileURLToPath(new URL('.', import.meta.url))

// vite 8 awaits async `configureServer` hooks before listening; the
// file-viewer plugin's dev hook copies ~2000 worker/WASM/vendor assets into
// `public/file-viewer/` (minutes on an AV-scanned disk), which made dev
// startup look like a hang. Restore vite 7's fire-and-forget semantics: the
// server listens immediately and assets land under `public/` as they copy.
function unblockDevAssetCopy(plugin: { configureServer?: unknown }): void {
  const original = plugin.configureServer
  if (typeof original !== 'function') return
  plugin.configureServer = function (this: unknown, server: unknown) {
    const result = (original as (s: unknown) => unknown).call(this, server)
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      ;(result as Promise<unknown>).catch((error: unknown) => {
        console.error('[file-viewer:vite-plugin] dev asset copy failed:', error)
      })
    }
  }
}

const fileViewer = fileViewerRenderers({ copyAssets: true })
unblockDevAssetCopy(fileViewer as { configureServer?: unknown })

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@markup/host-api': resolve(here, '../../../packages/host-api/src/index.ts'),
      '@markup/core': resolve(here, '../../../packages/core/src/index.ts'),
      '@markup/ui': resolve(here, '../../../packages/ui/src/index.ts'),
    },
  },
  plugins: [
    // Serves/copies the Full package's worker/WASM/font assets under
    // `file-viewer/` in both dev and build (```file embed previews).
    fileViewer,
  ],
  build: {
    outDir: 'dist',
  },
})