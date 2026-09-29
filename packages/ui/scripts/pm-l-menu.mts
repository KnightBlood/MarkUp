import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GLOBAL_SHORTCUTS, menuCommandIds, type HostMenuData } from '../../host-api/src/types'
import menuJson from '../../host-api/src/menu.json'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const data = menuJson as unknown as HostMenuData
const root = join(import.meta.dirname, '..', '..', '..')

// --- 1. structure ---
assert(Array.isArray(data.menu) && data.menu.length >= 4, `menu sections, got ${data.menu.length}`)
assert(Array.isArray(data.globalShortcuts) && data.globalShortcuts.length > 0, 'globalShortcuts present')

const ACTION_IDS = new Set(['quit', 'reload', 'devtools'])
const seen = new Set<string>()
function claim(id: string, where: string): void {
  assert(id && id.trim(), `${where}: empty id`)
  assert(!seen.has(id), `${where}: duplicate command id "${id}"`)
  seen.add(id)
}

for (const section of data.menu) {
  assert(section.label?.trim(), 'section needs label')
  assert(Array.isArray(section.items) && section.items.length > 0, `section "${section.label}": empty items`)
  for (const item of section.items) {
    const where = `section "${section.label}"`
    switch (item.kind) {
      case 'separator':
        break
      case 'command':
        claim(item.id, where)
        assert(item.label?.trim(), `${where}: command "${item.id}" needs label`)
        break
      case 'checkbox':
        assert(item.id?.trim(), `${where}: checkbox needs id`)
        assert(item.label?.trim(), `${where}: checkbox "${item.id}" needs label`)
        claim(item.on, `${where} checkbox ${item.id} on`)
        claim(item.off, `${where} checkbox ${item.id} off`)
        break
      case 'action':
        assert(ACTION_IDS.has(item.id), `${where}: unknown action "${item.id}"`)
        assert(item.label?.trim(), `${where}: action "${item.id}" needs label`)
        assert(item.accelerator, `${where}: action "${item.id}" needs accelerator`)
        break
      default:
        throw new Error(`${where}: unknown kind "${(item as { kind: string }).kind}"`)
    }
  }
}
for (const shortcut of data.globalShortcuts) {
  // Shortcuts reference menu commands (must already be defined above), not define new ones.
  assert(seen.has(shortcut.commandId), `globalShortcuts: "${shortcut.commandId}" not defined in menu`)
  assert(shortcut.accelerator?.trim(), `shortcut ${shortcut.commandId}: empty accelerator`)
  assert(shortcut.wailsAccelerator?.trim(), `shortcut ${shortcut.commandId}: empty wailsAccelerator`)
}
assert(seen.size >= 30, `expected 30+ unique command ids, got ${seen.size}`)

// --- 2. host-api exports stay in sync with the JSON source ---
assert(GLOBAL_SHORTCUTS.length === data.globalShortcuts.length, 'GLOBAL_SHORTCUTS length drift')
for (let i = 0; i < GLOBAL_SHORTCUTS.length; i++) {
  const a = GLOBAL_SHORTCUTS[i]!
  const b = data.globalShortcuts[i]!
  assert(
    a.commandId === b.commandId && a.accelerator === b.accelerator && a.wailsAccelerator === b.wailsAccelerator,
    `GLOBAL_SHORTCUTS[${i}] drifted from menu.json`,
  )
}
const helperIds = new Set(menuCommandIds(data))
for (const id of seen) assert(helperIds.has(id), `menuCommandIds() misses "${id}"`)

// --- 3. synced copies byte-match the single source ---
const source = readFileSync(join(root, 'packages', 'host-api', 'src', 'menu.json'))
for (const rel of [
  'apps/electron/shared/menu.json',
  'apps/tauri/src-tauri/src/menu.json',
  'apps/wails/menu.json',
]) {
  const copy = readFileSync(join(root, rel))
  assert(copy.equals(source), `out of sync with source: ${rel} (run: pnpm gen:menu)`)
}

// --- 4. every referenced command is registered in shell.ts ---
const shellSrc = readFileSync(join(root, 'packages', 'ui', 'src', 'shell.ts'), 'utf8')
const registered = new Set<string>()
for (const match of shellSrc.matchAll(/registry\.register\(\{\s*id:\s*'([^']+)'/g)) registered.add(match[1]!)
// Table commands register in a loop from TABLE_COMMANDS (palette-flagged specs).
for (const match of shellSrc.matchAll(/\{\s*id:\s*'(\w+)',\s*palette:/g)) registered.add(`table.${match[1]!}`)
assert(registered.size >= 50, `expected 50+ registered commands in shell.ts, got ${registered.size}`)
const missing = [...seen].filter((id) => !registered.has(id))
assert(missing.length === 0, `menu references unregistered commands: ${missing.join(', ')}`)

console.log(
  `SMOKE UI MENU OK: ${seen.size} menu command ids all registered, 3 copies in sync, ${registered.size} shell commands`,
)
