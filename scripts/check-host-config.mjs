/**
 * `AppConfig` (packages/host-api/src/types.ts) is the single source of truth
 * for the persisted app settings, but the Tauri (Rust) and Wails (Go) shells
 * re-declare it as a struct — and a struct silently DROPS every key it does
 * not know about when it writes the config back to disk. That is how
 * `bodyFont` / `codeFont` (and `shortcuts`, `restoreSession`, `openTabs`,
 * `activeTab`) stopped persisting on those two shells: the field applied
 * in-memory, then vanished on restart.
 *
 * This check keeps the structs in sync with the interface, so the next added
 * setting fails locally in a second instead of on a user's restart.
 *
 *   node scripts/check-host-config.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const TYPES = 'packages/host-api/src/types.ts'

/** Body of the block starting at `marker` (brace counted, comments stripped). */
function blockAfter(source, marker) {
  const start = source.indexOf(marker)
  if (start < 0) return null
  const open = source.indexOf('{', start)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

const stripComments = (body) =>
  body
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')

/** Property names of a TS interface (`name:` / `name?:` at any indent). */
function tsKeys(body) {
  const keys = []
  for (const line of stripComments(body).split('\n')) {
    const m = /^\s*([A-Za-z_$][\w$]*)\??\s*:/.exec(line)
    if (m) keys.push(m[1])
  }
  return keys
}

const snakeToCamel = (name) =>
  name.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase())

const read = (path) => {
  const abs = resolve(path)
  if (!existsSync(abs)) {
    console.error(`not found: ${path}`)
    process.exit(1)
  }
  return readFileSync(abs, 'utf8')
}

const appConfig = blockAfter(read(TYPES), 'export interface AppConfig')
if (!appConfig) {
  console.error(`could not locate \`export interface AppConfig\` in ${TYPES}`)
  process.exit(1)
}
const expected = tsKeys(appConfig)

/** Shells whose config is a typed struct (JSON-passthrough shells need no check). */
const STRUCT_HOSTS = [
  {
    name: 'tauri',
    file: 'apps/tauri/src-tauri/src/lib.rs',
    marker: 'struct AppConfig',
    keys: (body) => tsKeys(body),
  },
  {
    name: 'wails',
    file: 'apps/wails/services/host.go',
    marker: 'type AppConfig struct',
    keys: (body) =>
      [...stripComments(body).matchAll(/json:"([^",]+)/g)].map((m) => m[1]),
  },
]

const problems = []
for (const host of STRUCT_HOSTS) {
  const body = blockAfter(read(host.file), host.marker)
  if (!body) {
    problems.push(`${host.name}: could not locate \`${host.marker}\` in ${host.file}`)
    continue
  }
  const actual = new Set(host.keys(body).map(snakeToCamel))
  const missing = expected.filter((key) => !actual.has(key))
  const extra = [...actual].filter((key) => !expected.includes(key))
  if (missing.length > 0) {
    problems.push(`${host.name} (${host.file}) drops: ${missing.join(', ')}`)
  }
  if (extra.length > 0) {
    problems.push(`${host.name} (${host.file}) has keys absent from AppConfig: ${extra.join(', ')}`)
  }
}

if (problems.length > 0) {
  console.error('host config schema drift:')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('\nAppConfig fields: ' + expected.join(', '))
  process.exit(1)
}

console.log(
  `host config in sync: ${expected.length} AppConfig fields covered by ` +
    STRUCT_HOSTS.map((host) => host.name).join(' + '),
)
