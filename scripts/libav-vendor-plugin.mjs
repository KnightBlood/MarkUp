// Serves and ships avbridge's libav WASM engine (vendor/libav — LGPL-2.1, see
// NOTICE.md) so video playback beyond native formats works offline in every
// shell.
//
// avbridge resolves the engine through `globalThis.AVBRIDGE_LIBAV_BASE` (set
// by packages/core embeds before the lazy import to `<baseURI>/vendor/libav`),
// so the tree must be reachable at:
//   dev:   /vendor/libav/**            (this plugin's middleware)
//   build: <outDir>/vendor/libav/**    (copied in closeBundle — sibling of
//                                        `assets/`, so the default relative
//                                        lookup would also find it there)
//
// The loader does a Range probe via fetch() first, then dynamic-imports
// `<base>/<variant>/libav-<variant>.mjs`; a plain 200 answers the probe, so
// Range support is not required here.
import { createReadStream, cpSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve, sep } from 'node:path'

const MIME = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.d.ts': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
}

/** Resolves `node_modules/avbridge/vendor/libav` from packages/core's context. */
function resolveLibavDir() {
  const require = createRequire(new URL('../packages/core/package.json', import.meta.url))
  const entry = require.resolve('avbridge')
  return resolve(dirname(entry), '..', 'vendor', 'libav')
}

export function libavVendorPlugin() {
  let libavDir = null
  let outDir = null

  const ensureDir = () => {
    if (!libavDir) {
      libavDir = resolveLibavDir()
      if (!existsSync(libavDir)) {
        throw new Error(`[libav] vendor tree missing at ${libavDir} (avbridge not installed?)`)
      }
    }
    return libavDir
  }

  return {
    name: 'markup:libav-vendor',

    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },

    configureServer(server) {
      const dir = ensureDir()
      const root = resolve(dir)
      // Register eagerly (NOT as a post-hook): vite's SPA fallback rewrites
      // unmatched GETs to /index.html before post-hook middlewares run.
      // Serving these raw .mjs/.wasm files first also keeps them out of the
      // source-transform pipeline entirely.
      server.middlewares.use((req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0]
        const prefix = '/vendor/libav/'
        if (!pathOnly.startsWith(prefix)) return next()
        let rel = pathOnly.slice(prefix.length)
        try {
          rel = decodeURIComponent(rel)
        } catch {
          res.statusCode = 400
          res.end('bad path')
          return
        }
        const file = resolve(root, rel)
        if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404
          res.end('libav vendor file not found')
          return
        }
        res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
        res.setHeader('Access-Control-Allow-Origin', '*')
        createReadStream(file).pipe(res)
      })
    },

    closeBundle() {
      const target = join(outDir, 'vendor', 'libav')
      cpSync(ensureDir(), target, { recursive: true })
      console.log(`[libav] vendor tree -> ${target}`)
    },
  }
}
