/**
 * Document conversion for 导入文档 / 导出为….
 *
 * Markup never bundles a converter. This is process plumbing only: pick a
 * program, pass the four flags pandoc and carta both accept, feed it, and
 * surface the program's own stderr when it refuses.
 *
 * Bun runs this file, but it talks to `node:child_process` rather than
 * `Bun.spawn` — the module sits next to `node:fs` and `node:path` imports and
 * mirrors `apps/electron/src/main/converter.ts` line for line, so one shell's
 * fix can be read straight across to the other.
 *
 * Two facts here were measured against pandoc 3.12.1 rather than assumed:
 *
 *  - pandoc refuses to write docx/odt/epub to a terminal unless `-o -` is
 *    given, so export always passes `-o <path>` and lets the host own the
 *    file. Import reads text back off stdout, where writing is fine.
 *  - `--extract-media` emits absolute paths for an absolute directory and
 *    relative ones for a relative directory resolved against `cwd`. Import
 *    therefore passes a relative `mediaDir` with `cwd` set to the source
 *    file's folder, so the markdown keeps portable `<name>_files/...` links.
 */
import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type {
  ConvertRequest,
  ConvertResult,
  ConverterInfo,
} from '../../../../packages/host-api/src/types'

/** Tried in order when 设置 ▸ 编辑 ▸ 文档转换 has no path of its own. */
const PATH_CANDIDATES = ['pandoc', 'carta'] as const

const PROBE_TIMEOUT_MS = 15_000
const CONVERT_TIMEOUT_MS = 5 * 60_000

/** `--version` is the probe: it validates a hand-typed path and a PATH lookup alike. */
async function probeVersion(program: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(program, ['--version'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const timer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, PROBE_TIMEOUT_MS)
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      if (!out) out = chunk.toString('utf8')
    })
    const settle = (): void => {
      clearTimeout(timer)
      resolve(out.split(/\r?\n/, 1)[0]?.trim() || null)
    }
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', settle)
  })
}

/** The two programs are told apart by their own banner, never by their name. */
function kindOf(versionLine: string): ConverterInfo['kind'] {
  return /carta/i.test(versionLine) ? 'carta' : 'pandoc'
}

/**
 * Locate the converter. A path from 设置 ▸ 编辑 ▸ 文档转换 is authoritative: if it does
 * not run, this returns null instead of silently swapping in some other
 * program, so a typo can never make Markup convert with the wrong tool.
 */
export async function resolveConverter(
  configured: string | undefined,
): Promise<ConverterInfo | null> {
  const custom = configured?.trim()
  if (custom) {
    const version = await probeVersion(custom)
    return version ? { path: custom, kind: kindOf(version), version } : null
  }
  for (const program of PATH_CANDIDATES) {
    const version = await probeVersion(program)
    if (version) return { path: program, kind: kindOf(version), version }
  }
  return null
}

interface RunOptions {
  cwd?: string
  stdin?: string
}

/**
 * Run the converter once, returning stdout as raw bytes — the export
 * direction carries a zip, so decoding to text would corrupt it.
 */
function runConverter(program: string, args: string[], options: RunOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`转换超时（${CONVERT_TIMEOUT_MS / 1000} 秒）：${program}`))
    }, CONVERT_TIMEOUT_MS)

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    // The program exits early if it rejects the input — that must not become
    // an unhandled EPIPE on top of the real error already coming back.
    child.stdin.on('error', () => undefined)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        const detail = Buffer.concat(err).toString('utf8').trim()
        reject(new Error(detail || `${program} 退出码 ${code}`))
        return
      }
      resolve(Buffer.concat(out))
    })

    if (options.stdin !== undefined) child.stdin.end(options.stdin, 'utf8')
    else child.stdin.end()
  })
}

export async function convertDocument(
  configured: string | undefined,
  request: ConvertRequest,
): Promise<ConvertResult> {
  const info = await resolveConverter(configured)
  if (!info) {
    throw new Error('没有找到 pandoc 或 carta —— 请在 设置 ▸ 编辑 ▸ 文档转换 里填写它的路径。')
  }

  const args = ['-f', request.from, '-t', request.to]

  if (request.inputPath) {
    // Import: a real file in, markdown text off stdout. `cwd` plus a relative
    // `mediaDir` are what keep extracted images addressable from the markdown
    // rather than nailed to one absolute machine path.
    if (request.mediaDir) args.push(`--extract-media=${request.mediaDir}`)
    args.push(request.inputPath)
    const stdout = await runConverter(info.path, args, {
      cwd: request.cwd ?? dirname(request.inputPath),
    })
    return { text: stdout.toString('utf8'), program: info.path }
  }

  if (request.outputPath === undefined) {
    throw new Error('convert: 需要 inputPath 或 outputPath')
  }

  // Export: markdown in over stdin, the binary document out through `-o`.
  // cwd is the document's own folder so `![](./images/cover.png)` still
  // resolves into the package.
  args.push('-o', request.outputPath)
  await runConverter(info.path, args, {
    cwd: request.cwd ?? dirname(request.outputPath),
    stdin: request.text ?? '',
  })
  return { outputPath: request.outputPath, program: info.path }
}
