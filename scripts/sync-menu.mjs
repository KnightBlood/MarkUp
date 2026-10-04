import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'packages', 'host-api', 'src', 'menu.json')
const targets = [
  join(root, 'apps', 'electron', 'shared', 'menu.json'),
  join(root, 'apps', 'tauri', 'src-tauri', 'src', 'menu.json'),
  join(root, 'apps', 'wails', 'menu.json'),
  join(root, 'apps', 'electrobun', 'menu.json'),
]
for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
}
console.log(`synced menu.json -> ${targets.length} shells`)
