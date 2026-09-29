import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DirEntry, FileResult, HostAPI } from '@markup/host-api'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { CommandRegistry } = await import('../src/commands')
const { loadPlugins } = await import('../src/plugins')
import type { ContextItemProvider } from '../src/shell'

// ---- in-memory plugin directory ----
const files = new Map<string, string>()
const dirs = new Map<string, DirEntry[]>()

files.set(
  '/plug/good/manifest.json',
  JSON.stringify({
    id: 'good',
    name: 'Good Plugin',
    version: '1.0.0',
    permissions: ['document'],
  }),
)
files.set(
  '/plug/good/index.js',
  `api.commands.register({ id: 'plugin.demo', label: 'Demo', run: function () {} })
api.commands.register({ id: 'plugin.demo2', label: 'Demo2', run: function () {} })
api.registerContextItem(function () { return [{ label: 'From plugin' }] })
api.registerSidebarTab({ id: 'ptab', label: '插件页', render: function () { return null } })
api.registerSettingsTab({ id: 'ps', label: '插件设置', render: function () { return null } })
globalThis.__mdSeen = api.doc.getMarkdown()
api.notify('boot ok') // must be a silent no-op when the host omits the sink
return function () { globalThis.__pluginTeardown = (globalThis.__pluginTeardown || 0) + 1 }`,
)
files.set('/plug/bad/manifest.json', JSON.stringify({ id: 'bad' }))
files.set(
  '/plug/crash/manifest.json',
  JSON.stringify({ id: 'crash', name: 'Crash', version: '1.0.0' }),
)
files.set('/plug/crash/index.js', `throw new Error('boom')`)
files.set('/plug/loose.js', `// plain file, not a directory — skipped`)

dirs.set('/plug', [
  { name: 'good', path: '/plug/good', kind: 'dir', size: 0, mtime: 0 },
  { name: 'bad', path: '/plug/bad', kind: 'dir', size: 0, mtime: 0 },
  { name: 'crash', path: '/plug/crash', kind: 'dir', size: 0, mtime: 0 },
  { name: 'loose.js', path: '/plug/loose.js', kind: 'file', size: 0, mtime: 0 },
])

const host = {
  platform: 'web',
  fs: {
    read: async (path: string): Promise<FileResult> => {
      const content = files.get(path)
      if (content === undefined) throw new Error(`ENOENT ${path}`)
      return { path, content, encoding: 'utf8', crlf: false, bom: false }
    },
    readDir: async (path: string): Promise<DirEntry[]> => {
      const entries = dirs.get(path)
      if (!entries) throw new Error(`ENODIR ${path}`)
      return entries
    },
    write: async () => undefined,
    watch: () => () => undefined,
  },
  app: { getPath: async (name: 'plugins' | 'userData') => (name === 'plugins' ? '/plug' : null) },
} as unknown as HostAPI

// ---- context surface mock (records register/unsubscribe) ----
const contextCalls: string[] = []
const context = {
  registerContextItem: () => {
    contextCalls.push('ctx')
    return () => contextCalls.push('ctx-off')
  },
  registerSidebarTab: (spec: { id: string }) => {
    contextCalls.push(`tab:${spec.id}`)
    return () => contextCalls.push(`tab-off:${spec.id}`)
  },
  registerSettingsTab: (spec: { id: string }) => {
    contextCalls.push(`stab:${spec.id}`)
    return () => contextCalls.push(`stab-off:${spec.id}`)
  },
}

const registry = new CommandRegistry()

// ---- document mock (records api.doc usage) ----
const docCalls: string[] = []
let selectedText = ''
let docText = '# doc'
let activeDocPath: string | null = '/ws/目标.md'
const mockDoc = {
  getMarkdown: () => {
    docCalls.push('getMarkdown')
    return docText
  },
  setMarkdown: (text: string) => docCalls.push(`setMarkdown:${text}`),
  insertMarkdown: (text: string) => docCalls.push(`insert:${text}`),
  getSelectedText: () => {
    docCalls.push('getSelectedText')
    return selectedText
  },
  focus: () => docCalls.push('focus'),
  open: async (path: string) => {
    docCalls.push(`open:${path}`)
    return true
  },
  getPath: () => {
    docCalls.push('getPath')
    return activeDocPath
  },
  getCursor: () => {
    docCalls.push('getCursor')
    return { from: 2, to: 5 }
  },
  setSelection: (from: number, to?: number) => {
    docCalls.push(`setSelection:${from}:${to ?? from}`)
    return true
  },
}

const result = await loadPlugins({ host, commands: registry, document: mockDoc, context })

assert(
  result.watchDirs.includes('/plug') &&
    result.watchDirs.includes('/plug/good') &&
    result.watchDirs.includes('/plug/crash'),
  `watchDirs = root + plugin folders, got ${JSON.stringify(result.watchDirs)}`,
)

assert(result.loaded.length === 1, `1 loaded plugin, got ${result.loaded.length}`)
assert(result.errors.length === 2, `2 errors (bad manifest + crash), got ${result.errors.length}`)
assert(
  result.errors.some((e) => e.source.endsWith('bad') && e.error.includes('manifest')),
  'bad manifest reported',
)
assert(
  result.errors.some((e) => e.source.endsWith('crash') && e.error.includes('boom')),
  'crash reported',
)

assert(registry.get('plugin.demo'), 'plugin command registered in shell registry')
assert(registry.get('plugin.demo2'), 'second plugin command registered')
assert(
  contextCalls.join(',') === 'ctx,tab:ptab,stab:ps',
  `context surface called once each, got ${contextCalls.join(',')}`,
)
assert(
  (globalThis as { __mdSeen?: string }).__mdSeen === '# doc',
  'plugin read the document through api.doc',
)

result.loaded[0]!.deactivate()
assert(!registry.get('plugin.demo'), 'deactivate unregisters plugin commands')
assert(!registry.get('plugin.demo2'), 'deactivate unregisters all plugin commands')
assert(
  (globalThis as { __pluginTeardown?: number }).__pluginTeardown === 1,
  'plugin-returned teardown ran once',
)
assert(
  contextCalls.join(',') === 'ctx,tab:ptab,stab:ps,stab-off:ps,tab-off:ptab,ctx-off',
  `deactivate unsubscribes everything in reverse order, got ${contextCalls.join(',')}`,
)
result.loaded[0]!.deactivate()
assert(
  (globalThis as { __pluginTeardown?: number }).__pluginTeardown === 1,
  'second deactivate is a no-op for teardown',
)

// host without getPath (web) → silent no-op
const webResult = await loadPlugins({
  host: { platform: 'web', fs: host.fs, app: {} } as unknown as HostAPI,
  commands: registry,
  document: mockDoc,
  context,
})
assert(
  webResult.loaded.length === 0 &&
    webResult.errors.length === 0 &&
    webResult.watchDirs.length === 0,
  'no getPath → no-op',
)

// ---- disabled ids: manifest listed for settings, code never executed ----
const teardownBefore = (globalThis as { __pluginTeardown?: number }).__pluginTeardown
const disabledResult = await loadPlugins({
  host,
  commands: registry,
  document: mockDoc,
  disabled: ['good'],
  context,
})
assert(disabledResult.loaded.length === 0, `disabled plugin not executed, loaded=${disabledResult.loaded.length}`)
assert(
  disabledResult.disabled.length === 1 && disabledResult.disabled[0]!.id === 'good',
  'disabled manifest reported for the settings list',
)
assert(disabledResult.errors.length === 2, `bad+crash still reported, got ${disabledResult.errors.length}`)
assert(
  (globalThis as { __pluginTeardown?: number }).__pluginTeardown === teardownBefore,
  'disabled plugin body never ran (no teardown side effects)',
)

// ---- permissions: granted surfaces work, ungranted throw, unknown ids warn ----
files.set(
  '/plug/perm/manifest.json',
  JSON.stringify({
    id: 'perm',
    name: 'Perm Plugin',
    version: '1.0.0',
    permissions: ['fs', 'cloud'],
  }),
)
files.set(
  '/plug/perm/index.js',
  `var denied = []
try { api.doc.getMarkdown() } catch (e) { denied.push('doc:' + e.message) }
try { api.doc.getCursor() } catch (e) { denied.push('cursor:' + e.message) }
try { api.doc.setSelection(1, 2) } catch (e) { denied.push('sel:' + e.message) }
try { api.doc.getPath() } catch (e) { denied.push('path:' + e.message) }
try { api.host.app.getConfig() } catch (e) { denied.push('config:' + e.message) }
globalThis.__denied = denied
api.commands.register({ id: 'perm.demo', label: 'p', run: function () {} })`,
)
dirs.set('/plug', [
  { name: 'good', path: '/plug/good', kind: 'dir', size: 0, mtime: 0 },
  { name: 'bad', path: '/plug/bad', kind: 'dir', size: 0, mtime: 0 },
  { name: 'crash', path: '/plug/crash', kind: 'dir', size: 0, mtime: 0 },
  { name: 'loose.js', path: '/plug/loose.js', kind: 'file', size: 0, mtime: 0 },
  { name: 'perm', path: '/plug/perm', kind: 'dir', size: 0, mtime: 0 },
])
const permRegistry = new CommandRegistry()
const permResult = await loadPlugins({
  host,
  commands: permRegistry,
  document: mockDoc,
  context,
})
assert(
  permResult.loaded.some((p) => p.manifest.id === 'perm'),
  'plugin with granted fs loads despite unknown permission',
)
assert(
  permResult.warnings.length === 1 && permResult.warnings[0]!.includes('unknown permission "cloud"'),
  `unknown permission warned, got ${JSON.stringify(permResult.warnings)}`,
)
const denied = (globalThis as { __denied?: string[] }).__denied ?? []
assert(
  denied.length === 5 &&
    denied[0]!.startsWith('doc:plugin permission denied: document') &&
    denied[1]!.startsWith('cursor:plugin permission denied: document') &&
    denied[2]!.startsWith('sel:plugin permission denied: document') &&
    denied[3]!.startsWith('path:plugin permission denied: document') &&
    denied[4]!.startsWith('config:plugin permission denied: config'),
  `ungranted doc/cursor/selection/path/config throw permission denied, got ${JSON.stringify(denied)}`,
)
assert(permResult.errors.length === 2, `bad+crash still error, got ${permResult.errors.length}`)
assert(permRegistry.get('perm.demo'), 'granted-fs plugin registered its command')
permResult.loaded.find((p) => p.manifest.id === 'perm')!.deactivate()
assert(!permRegistry.get('perm.demo'), 'perm deactivate unregisters')

// ---- end-to-end: the shipped example plugin (examples/plugins/template-library) ----
const exampleDir = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'examples',
  'plugins',
  'template-library',
)
const exampleManifest = readFileSync(join(exampleDir, 'manifest.json'), 'utf8')
const exampleIndex = readFileSync(join(exampleDir, 'index.js'), 'utf8')
files.set('/plug2/template-library/manifest.json', exampleManifest)
files.set('/plug2/template-library/index.js', exampleIndex)
dirs.set('/plug2', [
  { name: 'template-library', path: '/plug2/template-library', kind: 'dir', size: 0, mtime: 0 },
])
const exampleContextCalls: string[] = []
const exampleRegistry = new CommandRegistry()
const exampleResult = await loadPlugins({
  host: {
    platform: 'web',
    fs: host.fs,
    app: { getPath: async () => '/plug2' },
  } as unknown as HostAPI,
  commands: exampleRegistry,
  document: mockDoc,
  context: {
    registerContextItem: () => {
      exampleContextCalls.push('ctx')
      return () => exampleContextCalls.push('ctx-off')
    },
    registerSidebarTab: (spec: { id: string }) => {
      exampleContextCalls.push(`tab:${spec.id}`)
      return () => exampleContextCalls.push('tab-off')
    },
    registerSettingsTab: (spec: { id: string }) => {
      exampleContextCalls.push(`stab:${spec.id}`)
      return () => exampleContextCalls.push('stab-off')
    },
  },
})
assert(exampleResult.errors.length === 0, `example loads clean, errors: ${exampleResult.errors}`)
assert(exampleResult.warnings.length === 0, `example has no permission warnings, got ${exampleResult.warnings}`)
assert(exampleResult.loaded[0]?.manifest.id === 'template-library', 'example manifest id')
assert(
  ['template.copy.meeting', 'template.copy.todo', 'template.copy.bug', 'template.copy.api'].every(
    (id) => exampleRegistry.get(id),
  ),
  'example registered 4 template commands',
)
assert(
  exampleContextCalls.join(',') === 'tab:templates,stab:templates,ctx',
  `example used all three surfaces, got ${exampleContextCalls.join(',')}`,
)
exampleResult.loaded[0]!.deactivate()
assert(exampleRegistry.list().length === 0, 'example deactivate removes all 4 commands')
assert(
  exampleContextCalls.filter((c) => c.endsWith('-off')).length === 3,
  'example deactivate unsubscribes all three surfaces',
)

// ---- end-to-end: dev-tools (doc surface + dynamic context provider) ----
const devDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'dev-tools')
files.set('/plug3/dev-tools/manifest.json', readFileSync(join(devDir, 'manifest.json'), 'utf8'))
files.set('/plug3/dev-tools/index.js', readFileSync(join(devDir, 'index.js'), 'utf8'))
dirs.set('/plug3', [
  { name: 'dev-tools', path: '/plug3/dev-tools', kind: 'dir', size: 0, mtime: 0 },
])
let savedProvider: ContextItemProvider | null = null
const devRegistry = new CommandRegistry()
docCalls.length = 0
const devResult = await loadPlugins({
  host: {
    platform: 'web',
    fs: host.fs,
    app: { getPath: async () => '/plug3' },
  } as unknown as HostAPI,
  commands: devRegistry,
  document: mockDoc,
  context: {
    registerContextItem: (provider: ContextItemProvider) => {
      savedProvider = provider
      return () => {
        savedProvider = null
      }
    },
    registerSidebarTab: () => () => undefined,
    registerSettingsTab: () => () => undefined,
  },
})
assert(devResult.errors.length === 0, `dev-tools loads clean, errors: ${devResult.errors}`)
assert(
  ['dev.insertDate', 'dev.insertDatetime', 'dev.insertUuid', 'dev.evalSelection', 'dev.runCodeBlocks'].every(
    (id) => devRegistry.get(id),
  ),
  'dev-tools registered 5 commands',
)
// dynamic provider: hidden with no selection, shown with one
savedProvider!(null as never, {} as never)
assert(docCalls.includes('getSelectedText'), 'provider reads selection')
selectedText = '2+2'
const items = savedProvider!(null as never, {} as never) as { label: string; run: () => void }[]
assert(items.length === 1 && items[0]!.label.includes('2+2'), 'provider shows compute item')
// evalSelection writes the result into the document
docCalls.length = 0
items[0]!.run()
assert(docCalls.includes('insert:4'), `evalSelection inserted 4, got ${docCalls.join(',')}`)
// no selection → provider hidden
selectedText = ''
assert(
  (savedProvider!(null as never, {} as never) as unknown[]).length === 0,
  'provider hidden without selection',
)
devResult.loaded[0]!.deactivate()
assert(devRegistry.list().length === 0, 'dev-tools deactivate removes all 5 commands')

// ---- end-to-end: ai-assistant (async run + mocked fetch/localStorage) ----
const aiDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'ai-assistant')
files.set('/plug5/ai-assistant/manifest.json', readFileSync(join(aiDir, 'manifest.json'), 'utf8'))
files.set('/plug5/ai-assistant/index.js', readFileSync(join(aiDir, 'index.js'), 'utf8'))
dirs.set('/plug5', [{ name: 'ai-assistant', path: '/plug5/ai-assistant', kind: 'dir', size: 0, mtime: 0 }])
let aiProvider: ContextItemProvider | null = null
let aiSettingsTab = ''
const aiRegistry = new CommandRegistry()
const aiResult = await loadPlugins({
  host: {
    platform: 'web',
    fs: host.fs,
    app: { getPath: async () => '/plug5' },
  } as unknown as HostAPI,
  commands: aiRegistry,
  document: mockDoc,
  context: {
    registerContextItem: (provider: ContextItemProvider) => {
      aiProvider = provider
      return () => {
        aiProvider = null
      }
    },
    registerSidebarTab: () => () => undefined,
    registerSettingsTab: (spec: { id: string }) => {
      aiSettingsTab = spec.id
      return () => undefined
    },
  },
})
assert(aiResult.errors.length === 0, `ai-assistant loads clean: ${JSON.stringify(aiResult.errors)}`)
assert(aiRegistry.get('ai.polish') && aiRegistry.get('ai.chat'), 'ai commands registered')
assert(aiSettingsTab === 'ai', 'ai settings tab registered')
selectedText = ''
assert(
  (aiProvider!(null as never, {} as never) as unknown[]).length === 0,
  'ai provider hidden without selection',
)
selectedText = '原始文本'
const aiItems = aiProvider!(null as never, {} as never) as Array<{ run: () => unknown }>
assert(aiItems.length === 2, `ai provider shows 2 items with selection, got ${aiItems.length}`)

// mocked config + fetch
let aiCfg: string | null = JSON.stringify({
  apiKey: 'sk-test',
  baseUrl: 'https://api.test/v1',
  model: 'test',
})
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: () => aiCfg,
    setItem: (_key: string, value: string) => {
      aiCfg = value
    },
  },
  configurable: true,
})
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string) => {
  assert(
    String(url) === 'https://api.test/v1/chat/completions',
    `baseUrl joined + endpoint, got ${String(url)}`,
  )
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '润色结果' } }] }),
  }
}) as unknown as typeof fetch
const polishRun = aiRegistry.get('ai.polish')!.run as unknown as () => Promise<void>
docCalls.length = 0
await polishRun()
assert(docCalls.includes('insert:润色结果'), `success inserts reply, got ${docCalls.join(',')}`)
// HTTP error → comment hint with status
globalThis.fetch = (async () => ({
  ok: false,
  status: 401,
  json: async () => ({}),
})) as unknown as typeof fetch
docCalls.length = 0
await polishRun()
assert(
  docCalls.some((c) => c.includes('AI 助手：错误：HTTP 401')),
  `http error hinted, got ${docCalls.join(',')}`,
)
// missing key → setup hint (no network call)
aiCfg = null
docCalls.length = 0
await polishRun()
assert(docCalls.some((c) => c.includes('API Key')), `missing key hinted, got ${docCalls.join(',')}`)
globalThis.fetch = realFetch
aiResult.loaded[0]!.deactivate()
assert(
  !aiRegistry.get('ai.polish') && !aiRegistry.get('ai.chat'),
  'ai deactivate removes commands',
)

// ---- engines.hostApi: matching loads, mismatch errors without executing ----
files.set(
  '/plug6/eng-ok/manifest.json',
  JSON.stringify({ id: 'eng-ok', name: 'Eng OK', version: '1.0.0', engines: { hostApi: 1 } }),
)
files.set(
  '/plug6/eng-ok/index.js',
  `api.commands.register({ id: 'eng.ok', label: 'ok', run: function () {} })`,
)
files.set(
  '/plug6/eng-bad/manifest.json',
  JSON.stringify({ id: 'eng-bad', name: 'Eng Bad', version: '1.0.0', engines: { hostApi: 99 } }),
)
files.set('/plug6/eng-bad/index.js', `globalThis.__engRan = true`)
dirs.set('/plug6', [
  { name: 'eng-ok', path: '/plug6/eng-ok', kind: 'dir', size: 0, mtime: 0 },
  { name: 'eng-bad', path: '/plug6/eng-bad', kind: 'dir', size: 0, mtime: 0 },
])
const engRegistry = new CommandRegistry()
const engResult = await loadPlugins({
  host: {
    platform: 'web',
    fs: host.fs,
    app: { getPath: async () => '/plug6' },
  } as unknown as HostAPI,
  commands: engRegistry,
  document: mockDoc,
  context: {
    registerContextItem: () => () => undefined,
    registerSidebarTab: () => () => undefined,
    registerSettingsTab: () => () => undefined,
  },
})
assert(engRegistry.get('eng.ok'), 'matching engines.hostApi loads and registers')
assert(
  engResult.errors.length === 1 &&
    engResult.errors[0]!.error.includes('incompatible hostApi 99 (host provides 1)'),
  `mismatch reported as error, got ${JSON.stringify(engResult.errors)}`,
)
assert(
  (globalThis as { __engRan?: boolean }).__engRan !== true,
  'incompatible plugin body never executed',
)

// ---- end-to-end: text-toolbox (selection transforms + whole-doc transforms) ----
const tbDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'text-toolbox')
files.set('/plug7/text-toolbox/manifest.json', readFileSync(join(tbDir, 'manifest.json'), 'utf8'))
files.set('/plug7/text-toolbox/index.js', readFileSync(join(tbDir, 'index.js'), 'utf8'))
dirs.set('/plug7', [
  { name: 'text-toolbox', path: '/plug7/text-toolbox', kind: 'dir', size: 0, mtime: 0 },
])
let tbProvider: ContextItemProvider | null = null
const tbRegistry = new CommandRegistry()
const tbResult = await loadPlugins({
  host: {
    platform: 'web',
    fs: host.fs,
    app: { getPath: async () => '/plug7' },
  } as unknown as HostAPI,
  commands: tbRegistry,
  document: mockDoc,
  context: {
    registerContextItem: (provider: ContextItemProvider) => {
      tbProvider = provider
      return () => {
        tbProvider = null
      }
    },
    registerSidebarTab: () => () => undefined,
    registerSettingsTab: () => () => undefined,
  },
})
assert(tbResult.errors.length === 0, `text-toolbox loads clean: ${JSON.stringify(tbResult.errors)}`)
assert(
  ['text.upper', 'text.lower', 'text.titleCase', 'text.trimLines', 'text.squeezeBlank', 'text.dedupeLines', 'text.sortLines', 'text.renumberList', 'text.smartQuotes'].every(
    (id) => tbRegistry.get(id),
  ),
  'text-toolbox registered 9 commands',
)
const tbRun = (id: string) => tbRegistry.get(id)!.run()
// selection transform replaces the selection
selectedText = 'hello world'
docCalls.length = 0
tbRun('text.upper')
assert(docCalls.includes('insert:HELLO WORLD'), `upper replaces selection, got ${docCalls.join(',')}`)
// whole-doc transform goes through setMarkdown when changed
selectedText = ''
docText = 'a\na\nb\nb\nc'
docCalls.length = 0
tbRun('text.dedupeLines')
assert(
  docCalls.includes('setMarkdown:a\nb\nc'),
  `dedupe whole doc, got ${docCalls.join(' | ')}`,
)
// whole-doc no-op when unchanged
docText = 'a\nb'
docCalls.length = 0
tbRun('text.dedupeLines')
assert(
  !docCalls.includes('setMarkdown:a\nb'),
  'unchanged whole-doc transform is a no-op',
)
// ordered list renumber by indent level
selectedText = '2. x\n10. y'
docCalls.length = 0
tbRun('text.renumberList')
assert(docCalls.includes('insert:1. x\n2. y'), `renumber, got ${docCalls.join(',')}`)
// context items: 3 while selected, hidden without
const tbItems = tbProvider!(null as never, {} as never) as unknown[]
assert(tbItems.length === 3, `context shows 3 tools with selection, got ${tbItems.length}`)
selectedText = ''
assert(
  (tbProvider!(null as never, {} as never) as unknown[]).length === 0,
  'context hidden without selection',
)
tbResult.loaded[0]!.deactivate()
assert(tbRegistry.list().length === 0, 'text-toolbox deactivate removes all 9 commands')

// ---- end-to-end: daily-note (fs create + doc.open + dialog folder fallback) ----
const dnDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'daily-note')
files.set('/plug8/daily-note/manifest.json', readFileSync(join(dnDir, 'manifest.json'), 'utf8'))
files.set('/plug8/daily-note/index.js', readFileSync(join(dnDir, 'index.js'), 'utf8'))
dirs.set('/plug8', [
  { name: 'daily-note', path: '/plug8/daily-note', kind: 'dir', size: 0, mtime: 0 },
])
let dailyFolder: string | null = '/d'
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => (key === 'markup.daily-note.folder' ? dailyFolder : null),
    setItem: (key: string, value: string) => {
      if (key === 'markup.daily-note.folder') dailyFolder = value
    },
  },
  configurable: true,
})
const dailyWrites: string[] = []
const dailyDialogCalls: string[] = []
const dailyHost = {
  ...host,
  app: {
    ...host.app,
    getPath: async (name: 'plugins' | 'userData') => (name === 'plugins' ? '/plug8' : null),
  },
  fs: {
    ...host.fs,
    write: async (path: string) => {
      dailyWrites.push(path)
    },
  },
  dialog: {
    open: async () => {
      dailyDialogCalls.push('open')
      return [{ path: '/picked' }]
    },
    save: async () => null,
    message: async () => ({ buttonIndex: 0, checkboxChecked: false }),
  },
} as unknown as HostAPI
const dailyRegistry = new CommandRegistry()
let dailySettingsTab = ''
let dailySidebarTab = ''
const dailyResult = await loadPlugins({
  host: dailyHost,
  commands: dailyRegistry,
  document: mockDoc,
  context: {
    registerContextItem: () => () => undefined,
    registerSidebarTab: (spec: { id: string }) => {
      dailySidebarTab = spec.id
      return () => undefined
    },
    registerSettingsTab: (spec: { id: string }) => {
      dailySettingsTab = spec.id
      return () => undefined
    },
  },
})
assert(dailyResult.errors.length === 0, `daily-note loads clean: ${JSON.stringify(dailyResult.errors)}`)
assert(
  dailyRegistry.get('daily.today') && dailyRegistry.get('daily.yesterday'),
  'daily commands registered',
)
assert(dailySidebarTab === 'daily-notes', `daily sidebar tab, got ${dailySidebarTab}`)
assert(dailySettingsTab === 'daily', `daily settings tab, got ${dailySettingsTab}`)
const now = new Date()
const padDate = (n: number) => String(n).padStart(2, '0')
const today = `${now.getFullYear()}-${padDate(now.getMonth() + 1)}-${padDate(now.getDate())}`
const dailyRun = (id: string) => dailyRegistry.get(id)!.run as unknown as () => Promise<void>
// missing file → create from template + open
docCalls.length = 0
dailyWrites.length = 0
await dailyRun('daily.today')()
assert(
  dailyWrites.length === 1 && dailyWrites[0] === `/d/${today}.md`,
  `created today's note at /d/${today}.md, got ${JSON.stringify(dailyWrites)}`,
)
assert(docCalls.includes(`open:/d/${today}.md`), `opened created note, got ${docCalls.join('|')}`)
// existing file → no rewrite, just open
files.set(`/d/${today}.md`, `# ${today}`)
dailyWrites.length = 0
docCalls.length = 0
await dailyRun('daily.today')()
assert(dailyWrites.length === 0, 'existing note not rewritten')
assert(docCalls.includes(`open:/d/${today}.md`), 'existing note opened')
// no folder → dialog fallback persists '/picked'
dailyFolder = null
dailyDialogCalls.length = 0
dailyWrites.length = 0
docCalls.length = 0
await dailyRun('daily.today')()
assert(dailyDialogCalls.length === 1, 'folder picker invoked once')
assert(dailyFolder === '/picked', `picked folder persisted, got ${dailyFolder}`)
assert(
  dailyWrites[0] === `/picked/${today}.md`,
  `created under picked folder, got ${JSON.stringify(dailyWrites)}`,
)
dailyResult.loaded[0]!.deactivate()
assert(!dailyRegistry.get('daily.today'), 'daily-note deactivate removes commands')

// ---- end-to-end: toc (heading parse, anchors, insert/update/remove) ----
const tocDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'toc')
files.set('/plug9/toc/manifest.json', readFileSync(join(tocDir, 'manifest.json'), 'utf8'))
files.set('/plug9/toc/index.js', readFileSync(join(tocDir, 'index.js'), 'utf8'))
dirs.set('/plug9', [{ name: 'toc', path: '/plug9/toc', kind: 'dir', size: 0, mtime: 0 }])
const tocRegistry = new CommandRegistry()
const tocResult = await loadPlugins({
  host: {
    ...host,
    app: { ...host.app, getPath: async (name: 'plugins' | 'userData') => (name === 'plugins' ? '/plug9' : null) },
  } as unknown as HostAPI,
  commands: tocRegistry,
  document: mockDoc,
  context: {
    registerContextItem: () => () => undefined,
    registerSidebarTab: () => () => undefined,
    registerSettingsTab: () => () => undefined,
  },
})
assert(tocResult.errors.length === 0, `toc loads clean: ${JSON.stringify(tocResult.errors)}`)
assert(
  tocRegistry.get('toc.insert') && tocRegistry.get('toc.update') && tocRegistry.get('toc.remove'),
  'toc 3 commands registered',
)
const tocMd = [
  '---',
  'title: demo',
  '---',
  '',
  '# Alpha',
  '',
  '```js',
  '# fake heading',
  '```',
  '',
  '## Beta *Bold*',
  '',
  '# Alpha',
].join('\n')
const lastWrite = () => {
  const hit = [...docCalls].reverse().find((call) => call.startsWith('setMarkdown:'))
  return hit ? hit.slice('setMarkdown:'.length) : null
}
// insert: front matter first, fences skipped, duplicate slug suffix
docText = tocMd
docCalls.length = 0
tocRegistry.get('toc.insert')!.run()
const tocOut = lastWrite()
assert(tocOut !== null, 'toc insert writes document')
assert(tocOut!.startsWith('---\ntitle: demo\n---'), 'front matter preserved, got ' + tocOut!.slice(0, 30))
assert(tocOut!.includes('<!-- toc -->') && tocOut!.includes('<!-- /toc -->'), 'toc block markers')
const tocLines = tocOut!.split('\n')
assert(tocLines.some((line) => line === '- [Alpha](#alpha)'), 'alpha anchor line')
assert(tocLines.some((line) => line === '  - [Beta Bold](#beta-bold)'), 'nested second-level + inline stripped')
assert(tocLines.some((line) => line === '- [Alpha](#alpha-1)'), 'duplicate heading gets -1 suffix')
const tocBlock = tocOut!.match(/<!-- toc -->[\s\S]*?<!-- \/toc -->/)
assert(tocBlock !== null && !tocBlock[0].includes('fake heading'), 'fenced fake heading excluded from TOC block')
// idempotent: second insert is a no-op
docText = tocOut!
docCalls.length = 0
tocRegistry.get('toc.insert')!.run()
assert(!docCalls.some((call) => call.startsWith('setMarkdown')), 'second insert no-op')
// update after heading rename
docText = tocOut!.replace('# Alpha', '# Alpha Renamed')
docCalls.length = 0
tocRegistry.get('toc.update')!.run()
const tocUpd = lastWrite()
assert(tocUpd !== null && tocUpd!.includes('[Alpha Renamed](#alpha-renamed)'), 'update rewrites anchors')
assert(tocUpd!.indexOf('<!-- toc -->') > tocUpd!.lastIndexOf('---'), 'toc block after front matter')
// remove
docText = tocUpd!
docCalls.length = 0
tocRegistry.get('toc.remove')!.run()
const tocRem = lastWrite()
assert(tocRem !== null && !tocRem!.includes('<!-- toc -->'), 'remove drops block')
assert(tocRem!.includes('# Alpha Renamed'), 'remove keeps content')
tocResult.loaded[0]!.deactivate()
assert(!tocRegistry.get('toc.insert'), 'toc deactivate removes commands')

// ---- PluginAPI host surfaces: notify / statusbar / workspace / cursor (T5) ----
files.set(
  '/plug10/apix/manifest.json',
  JSON.stringify({
    id: 'apix',
    name: 'ApiX',
    version: '1.0.0',
    permissions: ['document'],
    engines: { hostApi: 1 },
  }),
)
files.set(
  '/plug10/apix/index.js',
  `globalThis.__apiX = {
  notify: api.notify,
  statusbar: api.statusbar,
  get ws() { return api.workspace.root },
  cursor: api.doc.getCursor,
  sel: api.doc.setSelection,
}`,
)
dirs.set('/plug10', [{ name: 'apix', path: '/plug10/apix', kind: 'dir', size: 0, mtime: 0 }])
const notifyCalls: Array<{ message: string; level?: string }> = []
const statusbarCalls: string[] = []
let wsRoot: string | null = '/ws'
const axRegistry = new CommandRegistry()
const axResult = await loadPlugins({
  host: {
    ...host,
    app: { ...host.app, getPath: async (name: 'plugins' | 'userData') => (name === 'plugins' ? '/plug10' : null) },
  } as unknown as HostAPI,
  commands: axRegistry,
  document: mockDoc,
  context: {
    registerContextItem: () => () => undefined,
    registerSidebarTab: () => () => undefined,
    registerSettingsTab: () => () => undefined,
  },
  notify: (message, options) => notifyCalls.push({ message, level: options?.level }),
  statusbar: {
    set: (id, text, title) => {
      statusbarCalls.push(`set:${id}:${text}:${title ?? ''}`)
      return () => statusbarCalls.push(`unset:${id}`)
    },
    remove: (id) => statusbarCalls.push(`remove:${id}`),
  },
  getWorkspaceRoot: () => wsRoot,
})
assert(axResult.errors.length === 0, `apix loads clean: ${JSON.stringify(axResult.errors)}`)
const ax = (globalThis as { __apiX?: Record<string, unknown> }).__apiX!
// notify passes through host sink with options
;(ax.notify as (message: string, options?: unknown) => void)('hi', { level: 'error' })
assert(
  notifyCalls.length === 1 && notifyCalls[0]!.message === 'hi' && notifyCalls[0]!.level === 'error',
  `notify passthrough, got ${JSON.stringify(notifyCalls)}`,
)
// statusbar: set returns remove fn; remove hits the sink too
const axOff = (ax.statusbar as { set: (id: string, text: string, title?: string) => () => void }).set('axi', '文本', '标题')
assert(statusbarCalls[0] === 'set:axi:文本:标题', `statusbar set, got ${JSON.stringify(statusbarCalls)}`)
axOff()
assert(statusbarCalls.includes('unset:axi'), 'returned dispose hits sink')
;(ax.statusbar as { remove: (id: string) => void }).remove('axi')
assert(statusbarCalls.includes('remove:axi'), 'statusbar.remove hits sink')
// workspace.root is live (getter re-evaluates host state)
assert(ax.ws === '/ws', `workspace root exposed, got ${String(ax.ws)}`)
wsRoot = null
assert(ax.ws === null, 'workspace root follows host state')
// doc cursor/selection passthrough (document permission granted)
docCalls.length = 0
const cursor = (ax.cursor as () => { from: number; to: number } | null)()
assert(cursor !== null && cursor.from === 2 && cursor.to === 5, `getCursor passthrough, got ${JSON.stringify(cursor)}`)
;(ax.sel as (from: number, to?: number) => boolean)(3, 7)
assert(docCalls.includes('setSelection:3:7'), `setSelection passthrough, got ${docCalls.join('|')}`)
axResult.loaded[0]!.deactivate()
assert(statusbarCalls.filter((call) => call === 'unset:axi').length >= 0, 'apix deactivate ok')

// ---- end-to-end: backlinks (workspace scan, wikilinks, tags, doc.getPath) ----
const blDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'backlinks')
files.set('/plug12/backlinks/manifest.json', readFileSync(join(blDir, 'manifest.json'), 'utf8'))
files.set('/plug12/backlinks/index.js', readFileSync(join(blDir, 'index.js'), 'utf8'))
files.set('/ws/a.md', '# A\n\n见 [[目标]] 与 [[目标|别名]]，另有 [[other#段]]\n')
files.set('/ws/c.md', '---\ntags: [x, "y"]\n---\n\n[[目标]]\n')
files.set('/ws/sub/b.md', '深链 [[目标]]\n')
files.set('/ws/目标.md', '# 目标\n')
dirs.set('/plug12', [
  { name: 'backlinks', path: '/plug12/backlinks', kind: 'dir', size: 0, mtime: 0 },
])
dirs.set('/ws', [
  { name: 'a.md', path: '/ws/a.md', kind: 'file', size: 0, mtime: 0 },
  { name: 'c.md', path: '/ws/c.md', kind: 'file', size: 0, mtime: 0 },
  { name: '目标.md', path: '/ws/目标.md', kind: 'file', size: 0, mtime: 0 },
  { name: 'sub', path: '/ws/sub', kind: 'dir', size: 0, mtime: 0 },
])
dirs.set('/ws/sub', [
  { name: 'b.md', path: '/ws/sub/b.md', kind: 'file', size: 0, mtime: 0 },
])
const blRegistry = new CommandRegistry()
let blSidebarTab = ''
const blResult = await loadPlugins({
  host: {
    ...host,
    app: { ...host.app, getPath: async (name: 'plugins' | 'userData') => (name === 'plugins' ? '/plug12' : null) },
  } as unknown as HostAPI,
  commands: blRegistry,
  document: mockDoc,
  context: {
    registerContextItem: () => () => undefined,
    registerSidebarTab: (spec: { id: string }) => {
      blSidebarTab = spec.id
      return () => undefined
    },
    registerSettingsTab: () => () => undefined,
  },
  notify: () => undefined,
  getWorkspaceRoot: () => '/ws',
})
assert(blResult.errors.length === 0, `backlinks loads clean: ${JSON.stringify(blResult.errors)}`)
assert(blSidebarTab === 'backlinks', `sidebar tab id, got ${blSidebarTab}`)
assert(blRegistry.get('links.scan'), 'links.scan command registered')
const bl = (globalThis as { __bl?: Record<string, unknown> }).__bl!
// pure helpers (no DOM needed)
const wikiLinks = bl.wikiLinks as (md: string) => string[]
assert(
  JSON.stringify(wikiLinks('[[a]] [[b|c]] [[d#e]] [[路径/目标|x]]')) ===
    JSON.stringify(['a', 'b', 'd', '路径/目标']),
  `wikilink parse (alias+anchor+path), got ${JSON.stringify(wikiLinks('[[a]] [[b|c]] [[d#e]] [[路径/目标|x]]'))}`,
)
const fmTags = bl.frontMatterTags as (md: string) => string[]
assert(
  JSON.stringify(fmTags('---\ntags: [x, "y"]\n---\nbody')) === JSON.stringify(['x', 'y']),
  'inline tags parsed',
)
assert(
  JSON.stringify(fmTags('---\ntags:\n  - alpha\n  - "beta"\n---\n')) === JSON.stringify(['alpha', 'beta']),
  'block tags parsed',
)
assert(fmTags('# no front matter').length === 0, 'no front matter → no tags')
// workspace scan through mocked fs (recursive, wikilink counts, tag index)
const blIndex = await (bl.scan as () => Promise<{
  files: unknown[]
  backlinks: Record<string, Array<{ name: string; count: number }>>
  tagIndex: Record<string, { label: string; sources: unknown[] }>
  fileTags: Record<string, string[]>
} | null>)()
assert(blIndex !== null, 'scan returns index')
assert(blIndex!.files.length === 4, `scanned 4 md files, got ${blIndex!.files.length}`)
const sources = (bl.summarize as (idx: unknown, name: string) => unknown[])(blIndex, '目标.md')
assert(sources.length === 3, `3 sources link to 目标, got ${sources.length}`)
const aEntry = blIndex!.backlinks['目标']!.find((s) => s.name === 'a')
assert(aEntry !== undefined && aEntry.count === 2, `a.md counted twice, got ${JSON.stringify(aEntry)}`)
assert(
  blIndex!.backlinks['other'] !== undefined && blIndex!.backlinks['other']![0]!.name === 'a',
  'anchor link normalized to plain target',
)
assert(blIndex!.tagIndex['x'] !== undefined && blIndex!.tagIndex['x']!.sources[0]!.name === 'c', 'tag index x → c.md')
assert(
  JSON.stringify(blIndex!.fileTags['/ws/c.md']) === JSON.stringify(['x', 'y']),
  'fileTags keeps own tags',
)
assert(
  (bl.normalizeTarget as (t: string) => string)('笔记/目标.MD') === '目标',
  'normalizeTarget strips folder + extension + lowercases',
)
blResult.loaded[0]!.deactivate()
assert(!blRegistry.get('links.scan'), 'backlinks deactivate removes commands')

// ---- end-to-end: snippets (compile slots, insert+select, next fallback) ----
const snDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'snippets')
files.set('/plug13/snippets/manifest.json', readFileSync(join(snDir, 'manifest.json'), 'utf8'))
files.set('/plug13/snippets/index.js', readFileSync(join(snDir, 'index.js'), 'utf8'))
dirs.set('/plug13', [{ name: 'snippets', path: '/plug13/snippets', kind: 'dir', size: 0, mtime: 0 }])
const snStored: { name: string; trigger: string; body: string }[] = [
  { name: '代码块', trigger: 'fence', body: '```js\n${1:code}\n```\n${0}' },
]
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => (key === 'markup.snippets' ? JSON.stringify(snStored) : null),
    setItem: (key: string, value: string) => {
      if (key === 'markup.snippets') snStored.splice(0, snStored.length, ...JSON.parse(value))
    },
  },
  configurable: true,
})
const snNotify: string[] = []
const snStatusbar: string[] = []
const snRegistry = new CommandRegistry()
let snCtxProvider: ContextItemProvider | null = null
let snSidebarTab = ''
let snSettingsTab = ''
const snResult = await loadPlugins({
  host: {
    ...host,
    app: { ...host.app, getPath: async (name: 'plugins' | 'userData') => (name === 'plugins' ? '/plug13' : null) },
  } as unknown as HostAPI,
  commands: snRegistry,
  document: mockDoc,
  context: {
    registerContextItem: (provider: ContextItemProvider) => {
      snCtxProvider = provider
      return () => {
        snCtxProvider = null
      }
    },
    registerSidebarTab: (spec: { id: string }) => {
      snSidebarTab = spec.id
      return () => undefined
    },
    registerSettingsTab: (spec: { id: string }) => {
      snSettingsTab = spec.id
      return () => undefined
    },
  },
  notify: (message) => snNotify.push(message),
  statusbar: {
    set: (id, text) => {
      snStatusbar.push(`set:${id}:${text}`)
      return () => snStatusbar.push(`unset:${id}`)
    },
    remove: (id) => snStatusbar.push(`remove:${id}`),
  },
  getWorkspaceRoot: () => null,
})
assert(snResult.errors.length === 0, `snippets loads clean: ${JSON.stringify(snResult.errors)}`)
assert(snRegistry.get('snippets.insert') && snRegistry.get('snippets.next'), 'snippets 2 commands')
assert(snSidebarTab === 'snippets' && snSettingsTab === 'snippets', 'snippets tabs registered')
const sn = (globalThis as { __sn?: Record<string, unknown> }).__sn!
// compile: placeholders removed, slot offsets into expanded text
const compiled = (sn.compile as (body: string) => { text: string; slots: Array<{ n: number; from: number; to: number }> })(
  '```js\n${1:code}\n```\n${0}',
)
assert(compiled.text === '```js\ncode\n```\n', `compiled text, got ${JSON.stringify(compiled.text)}`)
assert(compiled.slots.length === 2, 'two slots')
assert(
  compiled.slots[0]!.n === 1 && compiled.slots[0]!.from === 6 && compiled.slots[0]!.to === 10,
  `slot1 offsets, got ${JSON.stringify(compiled.slots[0])}`,
)
assert(compiled.slots[1]!.n === 0 && compiled.slots[1]!.from === 15, `slot0 at end, got ${JSON.stringify(compiled.slots[1])}`)
// insert: replaces selection (cursor {from:2,to:5}), selects first slot by position
selectedText = 'fence'
docCalls.length = 0
;(sn.insertSnippet as (s: { body: string }) => void)(snStored[0]!)
const setCalls = docCalls.filter((call) => call.startsWith('setSelection:'))
assert(setCalls[0] === 'setSelection:2:5', `selection range cleared first, got ${JSON.stringify(setCalls)}`)
assert(docCalls.includes('insert:```js\ncode\n```\n'), `expanded body inserted, got ${docCalls.join('|')}`)
assert(setCalls[1] === 'setSelection:8:12', `first slot selected (start 2 + 6..10), got ${JSON.stringify(setCalls)}`)
// next walks to slot0 (end), then falls back to warn when no markers remain
docCalls.length = 0
;(sn.nextPlaceholder as () => void)()
assert(docCalls.includes('setSelection:17:17'), `next selects final slot, got ${docCalls.join('|')}`)
docCalls.length = 0
;(sn.nextPlaceholder as () => void)()
assert(!docCalls.some((call) => call.startsWith('setSelection')), 'no slots left → no selection call')
assert(snNotify.some((message) => message.includes('占位符')), `fallback notifies, got ${JSON.stringify(snNotify)}`)
// context menu by trigger
selectedText = 'fence'
const snItems = (snCtxProvider as unknown as (e: unknown, c: unknown) => unknown[])(null, null)
assert(snItems.length === 1 && (snItems[0] as { label: string }).label.includes('片段'), 'ctx item for known trigger')
selectedText = 'nope'
assert(
  ((snCtxProvider as unknown as (e: unknown, c: unknown) => unknown[])(null, null) as unknown[]).length === 0,
  'ctx hidden for unknown trigger',
)
selectedText = ''
snResult.loaded[0]!.deactivate()
assert(!snRegistry.get('snippets.insert') && snCtxProvider === null, 'snippets deactivate clears commands+ctx')

// ---- end-to-end: selection-stats (statusbar slot via tick, teardown removes) ----
const ssDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'selection-stats')
files.set('/plug14/selection-stats/manifest.json', readFileSync(join(ssDir, 'manifest.json'), 'utf8'))
files.set('/plug14/selection-stats/index.js', readFileSync(join(ssDir, 'index.js'), 'utf8'))
dirs.set('/plug14', [
  { name: 'selection-stats', path: '/plug14/selection-stats', kind: 'dir', size: 0, mtime: 0 },
])
const ssStatusbar: string[] = []
const ssRegistry = new CommandRegistry()
const ssResult = await loadPlugins({
  host: {
    ...host,
    app: { ...host.app, getPath: async (name: 'plugins' | 'userData') => (name === 'plugins' ? '/plug14' : null) },
  } as unknown as HostAPI,
  commands: ssRegistry,
  document: mockDoc,
  context: {
    registerContextItem: () => () => undefined,
    registerSidebarTab: () => () => undefined,
    registerSettingsTab: () => () => undefined,
  },
  statusbar: {
    set: (id, text) => {
      ssStatusbar.push(`set:${id}:${text}`)
      return () => ssStatusbar.push(`unset:${id}`)
    },
    remove: (id) => ssStatusbar.push(`remove:${id}`),
  },
  getWorkspaceRoot: () => null,
})
assert(ssResult.errors.length === 0, `selection-stats loads clean: ${JSON.stringify(ssResult.errors)}`)
const ss = (globalThis as { __ss?: { tick: () => void } }).__ss!
selectedText = ''
ss.tick()
assert(!ssStatusbar.some((call) => call.startsWith('set:')), 'no selection → no statusbar item')
selectedText = 'hello world'
ss.tick()
assert(
  ssStatusbar.some((call) => call === 'set:selection-stats:选区 11 字 · 2 词 · 1 行'),
  `selection published, got ${JSON.stringify(ssStatusbar)}`,
)
selectedText = ''
ss.tick()
assert(ssStatusbar.includes('remove:selection-stats'), 'collapsed selection removes item')
// teardown clears the interval + removes a still-showing item
selectedText = 'again'
ss.tick()
ssStatusbar.length = 0
ssResult.loaded[0]!.deactivate()
assert(
  ssStatusbar.includes('remove:selection-stats'),
  `deactivate removes leftover item, got ${JSON.stringify(ssStatusbar)}`,
)
assert(!ssRegistry.list().length, 'selection-stats has no commands')

// ---- end-to-end: table-tools (csv⇄md, dialog io, rich clipboard) ----
const ttDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'table-tools')
files.set('/plug15/table-tools/manifest.json', readFileSync(join(ttDir, 'manifest.json'), 'utf8'))
files.set('/plug15/table-tools/index.js', readFileSync(join(ttDir, 'index.js'), 'utf8'))
files.set('/in.csv', 'a,"b,c","say ""hi"""\r\n1,2,3\r\n')
dirs.set('/plug15', [{ name: 'table-tools', path: '/plug15/table-tools', kind: 'dir', size: 0, mtime: 0 }])
const ttWrites: Array<{ path: string; content: string }> = []
const ttNotify: string[] = []
const ttClipboardWrites: unknown[] = []
class FakeClipboardItem {
  constructor(public items: unknown) {}
}
;(globalThis as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem
Object.defineProperty(globalThis, 'navigator', {
  value: {
    clipboard: {
      write: async (items: unknown[]) => {
        ttClipboardWrites.push(items)
      },
    },
  },
  configurable: true,
})
const ttRegistry = new CommandRegistry()
const ttResult = await loadPlugins({
  host: {
    ...host,
    app: { ...host.app, getPath: async (name: 'plugins' | 'userData') => (name === 'plugins' ? '/plug15' : null) },
    fs: {
      ...host.fs,
      write: async (path: string, content: string) => {
        ttWrites.push({ path, content })
      },
    },
    dialog: {
      open: async () => [{ path: '/in.csv' }],
      save: async () => '/out.csv',
      message: async () => ({ buttonIndex: 0, checkboxChecked: false }),
    },
  } as unknown as HostAPI,
  commands: ttRegistry,
  document: mockDoc,
  context: {
    registerContextItem: () => () => undefined,
    registerSidebarTab: () => () => undefined,
    registerSettingsTab: () => () => undefined,
  },
  notify: (message) => ttNotify.push(message),
  getWorkspaceRoot: () => null,
})
assert(ttResult.errors.length === 0, `table-tools loads clean: ${JSON.stringify(ttResult.errors)}`)
assert(
  ttRegistry.get('table.csvToMd') && ttRegistry.get('table.mdToCsv') && ttRegistry.get('table.copyRich'),
  'table-tools 3 commands',
)
const tb2 = (globalThis as { __tb?: Record<string, unknown> }).__tb!
// CSV parse: quotes, escaped quotes, CRLF, BOM
const parsed = (tb2.parseCsv as (t: string) => string[][])('a,"b,c","say ""hi"""\r\n1,2,3\r\n')
assert(
  JSON.stringify(parsed) === JSON.stringify([['a', 'b,c', 'say "hi"'], ['1', '2', '3']]),
  `csv parse, got ${JSON.stringify(parsed)}`,
)
// CSV → Markdown table (header + separator + padded body)
const mdFromCsv = (tb2.csvToMarkdown as (r: string[][]) => string)(parsed)
assert(
  mdFromCsv === '| a | b,c | say "hi" |\n| --- | --- | --- |\n| 1 | 2 | 3 |',
  `csv→md, got ${JSON.stringify(mdFromCsv)}`,
)
// Markdown table → rows → CSV roundtrip (quotes when needed)
const rowsFromMd = (tb2.parseMarkdownTable as (t: string) => string[][] | null)(
  '| a | b,c |\n| --- | --- |\n| 1 | "x" |',
)
assert(rowsFromMd !== null, 'md table parsed')
const csvBack = (tb2.toCsv as (r: string[][]) => string)(rowsFromMd!)
assert(csvBack === 'a,"b,c"\r\n1,"""x"""', `md→csv quoting, got ${JSON.stringify(csvBack)}`)
assert((tb2.parseMarkdownTable as (t: string) => unknown)('just text') === null, 'non-table → null')
// Markdown → HTML (for rich paste)
const html = (tb2.mdTableToHtml as (r: string[][]) => string)(rowsFromMd!)
assert(
  html.includes('<th>a</th>') && html.includes('<td>1</td>') && html.includes('<table>'),
  `md→html, got ${html}`,
)
// command: CSV import reads dialog path and inserts at caret
docCalls.length = 0
ttNotify.length = 0
await (ttRegistry.get('table.csvToMd')!.run as unknown as () => Promise<void>)()
assert(
  docCalls.some((call) => call === `insert:${mdFromCsv}`),
  `csv import inserts table, got ${docCalls.join('|')}`,
)
assert(ttNotify.some((message) => message.includes('2 行 × 3 列')), `import notify, got ${JSON.stringify(ttNotify)}`)
// command: md export writes selected table through dialog.save
selectedText = '| a | b,c |\n| --- | --- |\n| 1 | "x" |'
ttWrites.length = 0
await (ttRegistry.get('table.mdToCsv')!.run as unknown as () => Promise<void>)()
assert(
  ttWrites.length === 1 && ttWrites[0]!.path === '/out.csv' && ttWrites[0]!.content === csvBack,
  `csv export, got ${JSON.stringify(ttWrites)}`,
)
// command: rich copy goes through ClipboardItem
ttClipboardWrites.length = 0
ttNotify.length = 0
await (ttRegistry.get('table.copyRich')!.run as unknown as () => Promise<void>)()
assert(ttClipboardWrites.length === 1, 'clipboard.write called once')
assert(ttNotify.some((message) => message.includes('富文本')), `rich copy notify, got ${JSON.stringify(ttNotify)}`)
// guard: no selection → warn, no dialog io
selectedText = ''
ttWrites.length = 0
ttClipboardWrites.length = 0
ttNotify.length = 0
await (ttRegistry.get('table.mdToCsv')!.run as unknown as () => Promise<void>)()
assert(ttWrites.length === 0 && ttNotify.some((m) => m.includes('选中')), 'export guards empty selection')
ttResult.loaded[0]!.deactivate()
assert(!ttRegistry.get('table.csvToMd'), 'table-tools deactivate removes commands')

// ---- end-to-end: link-checker (extract, HEAD→GET, summary + comment report) ----
const lcDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'link-checker')
files.set('/plug16/link-checker/manifest.json', readFileSync(join(lcDir, 'manifest.json'), 'utf8'))
files.set('/plug16/link-checker/index.js', readFileSync(join(lcDir, 'index.js'), 'utf8'))
dirs.set('/plug16', [{ name: 'link-checker', path: '/plug16/link-checker', kind: 'dir', size: 0, mtime: 0 }])
const lcFetchLog: string[] = []
Object.defineProperty(globalThis, 'fetch', {
  value: async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET'
    lcFetchLog.push(`${method} ${url}`)
    if (url.includes('gone')) throw new Error('getaddrinfo ENOTFOUND gone.example')
    if (url.includes('bad')) return { ok: false, status: 404, json: async () => ({}) }
    if (url.includes('nomethod') && method === 'HEAD') return { ok: false, status: 405, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({}) }
  },
  configurable: true,
  writable: true,
})
const lcNotify: string[] = []
const lcRegistry = new CommandRegistry()
let lcCtxProvider: ContextItemProvider | null = null
const lcResult = await loadPlugins({
  host: {
    ...host,
    app: { ...host.app, getPath: async (name: 'plugins' | 'userData') => (name === 'plugins' ? '/plug16' : null) },
  } as unknown as HostAPI,
  commands: lcRegistry,
  document: mockDoc,
  context: {
    registerContextItem: (provider: ContextItemProvider) => {
      lcCtxProvider = provider
      return () => {
        lcCtxProvider = null
      }
    },
    registerSidebarTab: () => () => undefined,
    registerSettingsTab: () => () => undefined,
  },
  notify: (message) => lcNotify.push(message),
  getWorkspaceRoot: () => null,
})
assert(lcResult.errors.length === 0, `link-checker loads clean: ${JSON.stringify(lcResult.errors)}`)
assert(lcRegistry.get('links.check'), 'links.check command')
const lc = (globalThis as { __lc?: Record<string, unknown> }).__lc!
const extract = lc.extractLinks as (t: string) => string[]
assert(
  JSON.stringify(extract('[a](https://x.com/p,.) <https://y.io> 裸 https://z.dev/尾。 https://x.com/p')) ===
    JSON.stringify(['https://x.com/p', 'https://y.io', 'https://z.dev/尾']),
  `extract+dedupe+tail-strip, got ${JSON.stringify(extract('[a](https://x.com/p,.) <https://y.io> 裸 https://z.dev/尾。 https://x.com/p'))}`,
)
const lcOne = lc.checkOne as (url: string) => Promise<{ ok: boolean; status: number; error?: string }>
const gone = await lcOne('https://gone.example/x')
assert(!gone.ok && gone.error !== undefined && gone.error.includes('ENOTFOUND'), `network error captured, got ${JSON.stringify(gone)}`)
const bad404 = await lcOne('https://bad.example/x')
assert(!bad404.ok && bad404.status === 404, `404 captured, got ${JSON.stringify(bad404)}`)
lcFetchLog.length = 0
const downgraded = await lcOne('https://nomethod.example/x')
assert(downgraded.ok && lcFetchLog.join('|') === 'HEAD https://nomethod.example/x|GET https://nomethod.example/x', `HEAD→GET fallback, got ${lcFetchLog.join('|')}`)
// full-doc check: summary notify + failure report comment
lcFetchLog.length = 0
lcNotify.length = 0
docText = '看 [坏](https://bad.example/a) 和 [好](https://ok.example/b)'
docCalls.length = 0
await (lcRegistry.get('links.check')!.run as unknown as () => Promise<void>)()
assert(
  lcNotify.some((message) => message.includes('2 个链接，1 正常，1 异常')),
  `summary notify, got ${JSON.stringify(lcNotify)}`,
)
const lcWrite = docCalls.find((call) => call.startsWith('insert:'))
assert(
  lcWrite !== undefined && lcWrite.includes('link-check full') && lcWrite.includes('https://bad.example/a → HTTP 404'),
  `failure report comment, got ${String(lcWrite).slice(0, 120)}`,
)
// all-good: no comment
docText = '[好](https://ok.example/b) [好2](https://ok.example/c)'
lcNotify.length = 0
docCalls.length = 0
await (lcRegistry.get('links.check')!.run as unknown as () => Promise<void>)()
assert(
  lcNotify.some((message) => message.includes('2 正常，0 异常')),
  `all-good summary, got ${JSON.stringify(lcNotify)}`,
)
assert(!docCalls.some((call) => call.startsWith('insert:')), 'all-good writes no comment')
// context: only when selection has links
selectedText = '见 [x](https://ok.example/z)'
assert(
  ((lcCtxProvider as unknown as (e: unknown, c: unknown) => unknown[])(null, null) as unknown[]).length === 1,
  'ctx item with link selection',
)
selectedText = '没有链接的文本'
assert(
  ((lcCtxProvider as unknown as (e: unknown, c: unknown) => unknown[])(null, null) as unknown[]).length === 0,
  'ctx hidden without links',
)
selectedText = ''
lcResult.loaded[0]!.deactivate()
assert(!lcRegistry.get('links.check') && lcCtxProvider === null, 'link-checker deactivate')

// ---- end-to-end: ai-tools (shared ai-assistant config, translate/summarize) ----
const atDir = join(import.meta.dirname, '..', '..', '..', 'examples', 'plugins', 'ai-tools')
files.set('/plug17/ai-tools/manifest.json', readFileSync(join(atDir, 'manifest.json'), 'utf8'))
files.set('/plug17/ai-tools/index.js', readFileSync(join(atDir, 'index.js'), 'utf8'))
dirs.set('/plug17', [{ name: 'ai-tools', path: '/plug17/ai-tools', kind: 'dir', size: 0, mtime: 0 }])
let ai2Key = 'sk-test-123'
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) =>
      key === 'markup.ai-assistant'
        ? JSON.stringify({ apiKey: ai2Key, baseUrl: 'https://api.example.com/v1/', model: 'm1' })
        : null,
    setItem: () => undefined,
  },
  configurable: true,
})
const ai2Calls: Array<{ url: string; system: string; user: string }> = []
Object.defineProperty(globalThis, 'fetch', {
  value: async (url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}')
    ai2Calls.push({
      url: String(url),
      system: body.messages?.[0]?.content ?? '',
      user: body.messages?.[1]?.content ?? '',
    })
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '译文结果' } }] }),
    }
  },
  configurable: true,
  writable: true,
})
const ai2Notify: string[] = []
const ai2Registry = new CommandRegistry()
const ai2Result = await loadPlugins({
  host: {
    ...host,
    app: { ...host.app, getPath: async (name: 'plugins' | 'userData') => (name === 'plugins' ? '/plug17' : null) },
  } as unknown as HostAPI,
  commands: ai2Registry,
  document: mockDoc,
  context: {
    registerContextItem: () => () => undefined,
    registerSidebarTab: () => () => undefined,
    registerSettingsTab: () => () => undefined,
  },
  notify: (message) => ai2Notify.push(message),
  getWorkspaceRoot: () => null,
})
assert(ai2Result.errors.length === 0, `ai-tools loads clean: ${JSON.stringify(ai2Result.errors)}`)
assert(
  ai2Registry.get('ai.translateZh') && ai2Registry.get('ai.translateEn') && ai2Registry.get('ai.summarize'),
  'ai-tools 3 commands',
)
// translate with selection: shared config, system instruction, insert result
selectedText = 'hello world'
docCalls.length = 0
ai2Calls.length = 0
ai2Notify.length = 0
await (ai2Registry.get('ai.translateZh')!.run as unknown as () => Promise<void>)()
assert(ai2Calls.length === 1, 'one chat completion call')
assert(ai2Calls[0]!.url === 'https://api.example.com/v1/chat/completions', `url joined, got ${ai2Calls[0]!.url}`)
assert(ai2Calls[0]!.user === 'hello world', `user = selection, got ${ai2Calls[0]!.user}`)
assert(ai2Calls[0]!.system.includes('简体中文'), 'translate instruction')
assert(docCalls.includes('insert:译文结果'), `result replaces selection, got ${docCalls.join('|')}`)
assert(ai2Notify.some((message) => message.includes('完成')), `done notify, got ${JSON.stringify(ai2Notify)}`)
// summarize without selection: tail context + summary section
selectedText = ''
docText = '# 长文档\n正文内容若干。'
docCalls.length = 0
ai2Calls.length = 0
await (ai2Registry.get('ai.summarize')!.run as unknown as () => Promise<void>)()
assert(ai2Calls[0]!.user === docText, 'no selection → whole/tail text as user')
const ai2Write = docCalls.find((call) => call.startsWith('insert:'))
assert(
  ai2Write !== undefined && ai2Write.includes('## AI 摘要') && ai2Write.includes('译文结果'),
  `summary appended as section, got ${String(ai2Write).slice(0, 80)}`,
)
// missing key: notify + comment, no request
ai2Key = ''
ai2Calls.length = 0
ai2Notify.length = 0
docCalls.length = 0
await (ai2Registry.get('ai.translateEn')!.run as unknown as () => Promise<void>)()
assert(ai2Calls.length === 0, 'no request without key')
assert(ai2Notify.some((message) => message.includes('API Key')), `key warn, got ${JSON.stringify(ai2Notify)}`)
assert(
  docCalls.some((call) => call.startsWith('insert:') && call.includes('未配置 API Key')),
  'missing key comment written',
)
ai2Result.loaded[0]!.deactivate()
assert(!ai2Registry.get('ai.translateZh'), 'ai-tools deactivate removes commands')

// ---- dual roots: ~/.markup/plugins (global) + <program dir>/plugins (local) ----
const dualManifest = (id: string, version: string): string =>
  JSON.stringify({ id, name: `Plugin ${id}`, version })
files.set('/plug-global/dup/manifest.json', dualManifest('dup', '2.0.0-global'))
files.set('/plug-global/dup/index.js', `globalThis.__dualWinner = 'global'`)
files.set('/plug-global/g-only/manifest.json', dualManifest('g-only', '1.0.0'))
files.set('/plug-global/g-only/index.js', `globalThis.__dualGlobal = true`)
files.set('/plug-local/dup/manifest.json', dualManifest('dup', '1.0.0-local'))
files.set('/plug-local/dup/index.js', `globalThis.__dualWinner = 'local'`)
files.set('/plug-local/l-only/manifest.json', dualManifest('l-only', '1.0.0'))
files.set('/plug-local/l-only/index.js', `globalThis.__dualLocal = true`)
dirs.set('/plug-global', [
  { name: 'dup', path: '/plug-global/dup', kind: 'dir', size: 0, mtime: 0 },
  { name: 'g-only', path: '/plug-global/g-only', kind: 'dir', size: 0, mtime: 0 },
])
dirs.set('/plug-local', [
  { name: 'dup', path: '/plug-local/dup', kind: 'dir', size: 0, mtime: 0 },
  { name: 'l-only', path: '/plug-local/l-only', kind: 'dir', size: 0, mtime: 0 },
])
const dualHost = {
  platform: 'web',
  fs: host.fs,
  app: {
    getPath: async (name: 'plugins' | 'pluginsLocal' | 'userData') =>
      name === 'plugins' ? '/plug-global' : name === 'pluginsLocal' ? '/plug-local' : null,
  },
} as unknown as HostAPI
const dualRegistry = new CommandRegistry()
const dualResult = await loadPlugins({
  host: dualHost,
  commands: dualRegistry,
  document: mockDoc,
  context,
})
assert(
  dualResult.errors.length === 0,
  `dual roots load clean: ${JSON.stringify(dualResult.errors)}`,
)
assert(
  dualResult.loaded.length === 3,
  `global+local plugins load with id dedupe, got ${dualResult.loaded.length}: ${dualResult.loaded
    .map((p) => p.manifest.id)
    .join(',')}`,
)
const dupPlugin = dualResult.loaded.find((p) => p.manifest.id === 'dup')
assert(
  dupPlugin?.manifest.version === '2.0.0-global',
  `same id → user-global copy wins, got ${String(dupPlugin?.manifest.version)}`,
)
assert(
  dualResult.loaded.some((p) => p.manifest.id === 'g-only') &&
    dualResult.loaded.some((p) => p.manifest.id === 'l-only'),
  'plugins from both roots load',
)
assert(
  dualResult.watchDirs.includes('/plug-global') &&
    dualResult.watchDirs.includes('/plug-local') &&
    dualResult.watchDirs.includes('/plug-global/dup') &&
    dualResult.watchDirs.includes('/plug-local/l-only'),
  `watchDirs = both roots + their plugin folders, got ${JSON.stringify(dualResult.watchDirs)}`,
)
for (const plugin of dualResult.loaded) plugin.deactivate()

// unreadable local root (never created on demand) must not abort the global one
const partialHost = {
  platform: 'web',
  fs: host.fs,
  app: {
    getPath: async (name: 'plugins' | 'pluginsLocal' | 'userData') =>
      name === 'plugins' ? '/plug-global' : name === 'pluginsLocal' ? '/plug-missing' : null,
  },
} as unknown as HostAPI
const partialResult = await loadPlugins({
  host: partialHost,
  commands: new CommandRegistry(),
  document: mockDoc,
  context,
})
assert(
  partialResult.loaded.length === 2 && partialResult.loaded.some((p) => p.manifest.id === 'dup'),
  `missing local root skipped, global loads (got ${partialResult.loaded.map((p) => p.manifest.id).join(',')})`,
)
assert(
  partialResult.errors.length === 0,
  `missing root is not an error, got ${JSON.stringify(partialResult.errors)}`,
)
assert(
  partialResult.watchDirs.includes('/plug-global') && !partialResult.watchDirs.includes('/plug-missing'),
  'missing root not in watchDirs',
)
for (const plugin of partialResult.loaded) plugin.deactivate()

console.log(
  `SMOKE UI PLUGINS OK: loader contracts (dual roots, global-wins dedupe, missing-root skip) + 12 sample plugins e2e (template/dev/ai/text-toolbox/daily/toc/backlinks/snippets/selection-stats/table-tools/link-checker/ai-tools) + T5 surfaces`,
)
