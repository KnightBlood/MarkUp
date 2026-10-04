/**
 * electron-builder validates its config against a JSON schema with
 * `additionalProperties: false`, so a single unknown key fails the whole
 * package step — but only inside CI, minutes into the job. This checks the
 * keys used in `electron-builder.yml` against the schema that ships with
 * app-builder-lib, so typos surface locally in a second.
 *
 *   node scripts/check-electron-builder-config.mjs apps/electron/electron-builder.yml
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

const configPath = resolve(process.argv[2] ?? 'apps/electron/electron-builder.yml')
if (!existsSync(configPath)) {
  console.error(`not found: ${configPath}`)
  process.exit(1)
}

const pnpmDir = resolve('node_modules/.pnpm')
const schemeEntry = readdirSync(pnpmDir).find((name) => name.startsWith('app-builder-lib@'))
if (!schemeEntry) {
  console.error('app-builder-lib not installed; run pnpm install first')
  process.exit(1)
}
const schemePath = join(pnpmDir, schemeEntry, 'node_modules/app-builder-lib/scheme.json')
const scheme = JSON.parse(readFileSync(schemePath, 'utf8'))
const definitions = scheme.definitions

/** Follow `$ref` / `anyOf` down to the definition that owns the `properties`. */
function resolveDefinition(schema) {
  if (!schema) return null
  if (schema.$ref) return definitions[schema.$ref.split('/').pop()] ?? null
  if (Array.isArray(schema.anyOf)) {
    for (const alternative of schema.anyOf) {
      const resolved = resolveDefinition(alternative)
      if (resolved) return resolved
    }
  }
  return null
}

const config = parse(readFileSync(configPath, 'utf8'))
const problems = []

for (const [key, value] of Object.entries(config)) {
  const schema = scheme.properties[key]
  if (!schema) {
    problems.push(`'${key}' is not a valid electron-builder option`)
    continue
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
  const definition = resolveDefinition(schema)
  if (!definition?.properties) continue
  for (const nested of Object.keys(value)) {
    if (!(nested in definition.properties)) {
      problems.push(`'${key}.${nested}' is not a valid ${key} option`)
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`INVALID ${problem}`)
  process.exit(1)
}
console.log(
  `electron-builder config OK: ${Object.keys(config).length} top-level options validated against app-builder-lib`,
)
