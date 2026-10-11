import type { HostAPI } from './types'

export interface VerifyIssue {
  name: string
  reason: string
}

export interface VerifyReport {
  ok: boolean
  platform?: HostAPI['platform']
  issues: VerifyIssue[]
}

const REQUIRED_METHODS: Array<[name: string, getter: (host: HostAPI) => unknown]> = [
  ['fs.read', (host) => host.fs.read],
  ['fs.write', (host) => host.fs.write],
  ['fs.readDir', (host) => host.fs.readDir],
  ['fs.watch', (host) => host.fs.watch],
  ['fs.readBase64', (host) => host.fs.readBase64],
  ['dialog.open', (host) => host.dialog.open],
  ['dialog.save', (host) => host.dialog.save],
  ['dialog.message', (host) => host.dialog.message],
  ['app.openExternal', (host) => host.app.openExternal],
  ['app.setTitle', (host) => host.app.setTitle],
  ['app.getConfig', (host) => host.app.getConfig],
  ['app.setConfig', (host) => host.app.setConfig],
  ['app.on', (host) => host.app.on],
]

function expectFunction(target: unknown, name: string, issues: VerifyIssue[]): void {
  if (typeof target !== 'function') {
    issues.push({ name, reason: `missing or not a function (actual: ${typeof target})` })
  }
}

const ROUND_TRIP_TIMEOUT_MS = 3000

export async function verifyHost(host: HostAPI | undefined): Promise<VerifyReport> {
  if (!host) {
    return { ok: false, issues: [{ name: '__HOST__', reason: 'HostAPI 未注入' }] }
  }
  const issues: VerifyIssue[] = []
  for (const [name, getter] of REQUIRED_METHODS) {
    try {
      expectFunction(getter(host), name, issues)
    } catch (error) {
      issues.push({ name, reason: `probe threw: ${String(error)}` })
    }
  }
  try {
    await Promise.race([
      host.app.getConfig(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`round-trip timeout (${ROUND_TRIP_TIMEOUT_MS}ms)`)), ROUND_TRIP_TIMEOUT_MS)),
    ])
  } catch (error) {
    issues.push({ name: 'app.getConfig()', reason: `round-trip failed: ${String(error)}` })
  }
  // 图像 ▸ 插入图片时 uses both or neither: a host that can write bytes but
  // not create the target directory would only ever fail at the mkdir step.
  if (typeof host.fs.writeBase64 === 'function' && typeof host.fs.mkdirp !== 'function') {
    issues.push({ name: 'fs.mkdirp', reason: 'required alongside fs.writeBase64' })
  }
  return { ok: issues.length === 0, platform: host.platform, issues }
}