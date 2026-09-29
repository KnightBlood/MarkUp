// Bundles @markup/host-api into a CJS single file inside the electron app's
// compiled main output. tsc emits workspace imports verbatim
// (`require('@markup/host-api')`) and electron-builder ships only `dist/**/*`
// plus `package.json` — pnpm workspace packages are not present at runtime.
// Placing the bundle at `dist/main/node_modules/@markup/host-api/index.js`
// lets Node's upward lookup resolve it from `dist/main/src/main/main.js`.
//
// Uses esbuild's **JS API** (resolved from the electron package) instead of the
// `esbuild` CLI on PATH: the CLI is only reachable when the invoking script's
// node_modules/.bin is on PATH, which holds locally under pnpm but not in CI
// (`/bin/sh: esbuild: not found` on GitHub runners).
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(here, '..')
const appDir = resolve(repo, 'apps/electron')
const outDir = resolve(appDir, 'dist/main/node_modules/@markup/host-api')
mkdirSync(outDir, { recursive: true })

const outfile = resolve(outDir, 'index.js')

// Resolve esbuild from the electron app (pnpm's strict node_modules layout).
const require = createRequire(resolve(appDir, 'package.json'))
let esbuild
try {
  esbuild = require('esbuild')
} catch (error) {
  console.error('[electron] esbuild could not be resolved from apps/electron:', error)
  process.exit(1)
}

await esbuild
  .build({
    entryPoints: [resolve(repo, 'packages/host-api/src/index.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    outfile,
    logLevel: 'warning',
  })
  .catch((error) => {
    console.error('[electron] host-api bundling failed:', error)
    process.exit(1)
  })

writeFileSync(
  resolve(outDir, 'package.json'),
  JSON.stringify({ name: '@markup/host-api', version: '0.1.0', main: 'index.js' }, null, 2) + '\n',
)

if (!existsSync(outfile)) {
  console.error('[electron] host-api bundle was not written')
  process.exit(1)
}
console.log('[electron] bundled @markup/host-api -> dist/main/node_modules/@markup/host-api/index.js')
