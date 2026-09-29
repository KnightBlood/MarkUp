import { existsSync, readdirSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { fileViewerRenderers } from '@file-viewer/vite-plugin'

const here = fileURLToPath(new URL('.', import.meta.url))

// vite 8 awaits async `configureServer` hooks before listening, and this
// plugin's dev hook rewrites ~2000 asset files (several minutes on this
// AV-scanned disk) — startup appeared to hang with zero output. Restore the
// vite 7 fire-and-forget semantics: kick off the copy without blocking,
// let vite listen immediately; files are served from `public/` as they land.
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

// `vite build`'s default publicDir copy dies with EPERM on two AV-locked
// empty leaf dirs (`public/vendor/pdf/fonts`, `public/wasm/typst`) that can't
// be deleted without admin. Skip `build.copyPublicDir` and copy the rest
// manually; those two shells contain no real files (public scan: 0 files
// outside `file-viewer/`, which its own plugin already copies).
function copyPublicSandboxSafe(): Plugin {
  const skip = new Set(['vendor', 'wasm'])
  return {
    name: 'markup:copy-public-sandbox-safe',
    apply: 'build',
    closeBundle() {
      const pub = resolve(here, 'public')
      if (!existsSync(pub)) return
      const out = resolve(here, 'dist')
      for (const entry of readdirSync(pub, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue
        cpSync(join(pub, entry.name), join(out, entry.name), { recursive: true })
      }
    },
  }
}

export default defineConfig({
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
    fileViewer,
    copyPublicSandboxSafe(),
  ],
  build: {
    copyPublicDir: false,
  },
  server: {
    port: 5173,
  },
})