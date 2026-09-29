/**
 * Linux 大小写敏感审计：Windows 上 `./TabBar` 也能命中 `tabBar.ts`，Linux 直接失败。
 * 扫描源码里所有相对 import/require/动态 import，逐个用「按目录列出真实文件名」的方式
 * 校验大小写完全一致。
 *
 *   node scripts/check-case.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] ?? '.')
const SKIP = new Set(['node_modules', 'dist', 'release', 'target', '.git', 'out', 'coverage', '参考项目', 'artifacts'])
const EXT = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json', '.css'])

const files = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue
    if (SKIP.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (EXT.has(entry.name.slice(entry.name.lastIndexOf('.')))) files.push(full)
  }
}
walk(root)

/** 真实名字映射（按目录缓存），命中失败时给出「忽略大小写的近似名」 */
const dirCache = new Map()
function realNames(dir) {
  if (!dirCache.has(dir)) {
    try {
      dirCache.set(dir, new Set(readdirSync(dir)))
    } catch {
      dirCache.set(dir, new Set())
    }
  }
  return dirCache.get(dir)
}

const problems = []
const IMPORT_RE = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]+)['"]/g

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1]
    const target = resolve(dirname(file), spec)
    const candidates = []

    // 目录 import（含 index）与文件 import 各试一次，允许省略扩展名
    const base = [target, `${target}.ts`, `${target}.mts`, `${target}.js`, `${target}.mjs`, `${target}.json`, `${target}.css`, join(target, 'index.ts'), join(target, 'index.mjs')]
    for (const candidate of base) {
      const dir = dirname(candidate)
      const name = candidate.slice(dir.length + 1)
      const names = realNames(dir)
      if (names.has(name)) {
        candidates.push(candidate)
        break
      }
      // 忽略大小写命中 → 交给下面报错（保留近似名提示）
      const approx = [...names].find((entry) => entry.toLowerCase() === name.toLowerCase())
      if (approx) {
        problems.push({ file: relative(root, file), spec, expected: name, actual: approx })
        candidates.push(candidate)
        break
      }
    }
  }
}

if (problems.length === 0) {
  console.log(`CASE OK: ${files.length} files, 0 mismatched relative paths`)
} else {
  for (const p of problems) {
    console.log(`CASE MISMATCH  ${p.file}  imports "${p.spec}"  ->  disk has "${p.actual}" (expected "${p.expected}")`)
  }
  console.log(`CASE FAIL: ${problems.length} mismatch(es)`)
  process.exit(1)
}
