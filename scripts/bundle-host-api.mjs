// Bundles @markup/host-api into a CJS single file inside the electron app's
// compiled main output. tsc emits workspace imports verbatim
// (`require('@markup/host-api')`) and electron-builder ships only `dist/**/*`
// plus `package.json` — pnpm workspace packages are not present at runtime.
// Placing the bundle at `dist/main/node_modules/@markup/host-api/index.js`
// lets Node's upward lookup resolve it from `dist/main/src/main/main.js`.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(here, '..')
const outDir = resolve(repo, 'apps/electron/dist/main/node_modules/@markup/host-api')
mkdirSync(outDir, { recursive: true })

const outfile = resolve(outDir, 'index.js')
const command = [
  'esbuild',
  resolve(repo, 'packages/host-api/src/index.ts'),
  '--bundle',
  '--format=cjs',
  '--platform=node',
  '--target=node20',
  `--outfile=${outfile}`,
  '--log-level=warning',
]
  .map((part) => (/\s/.test(part) ? `"${part}"` : part))
  .join(' ')
const result = spawnSync(command, { stdio: 'inherit', shell: true })
if (result.status !== 0) {
  console.error('[electron] host-api bundling failed')
  process.exit(result.status ?? 1)
}

writeFileSync(
  resolve(outDir, 'package.json'),
  JSON.stringify({ name: '@markup/host-api', version: '0.1.0', main: 'index.js' }, null, 2) + '\n',
)

if (!existsSync(outfile)) {
  console.error('[electron] host-api bundle was not written')
  process.exit(1)
}
console.log('[electron] bundled @markup/host-api -> dist/main/node_modules/@markup/host-api/index.js')
