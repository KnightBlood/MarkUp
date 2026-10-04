function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { attachHostEvents, systemThemeClass } = await import('../src/hostEvents')
const { GLOBAL_SHORTCUTS } = await import('@markup/host-api')

assert(systemThemeClass('dark') === 'theme-dark', 'explicit dark')
assert(systemThemeClass('light') === 'theme-light', 'explicit light')
assert(systemThemeClass(null, true) === 'theme-dark', 'fallback prefers dark')
assert(systemThemeClass(null, false) === 'theme-light', 'fallback prefers light')
assert(systemThemeClass(null) === 'theme-light', 'fallback default light')

assert(GLOBAL_SHORTCUTS.length === 2, 'two global shortcut pairs')
assert(
  GLOBAL_SHORTCUTS.every((s) => s.commandId && s.accelerator && s.wailsAccelerator),
  'pairs have commandId + both accelerator forms',
)
assert(
  GLOBAL_SHORTCUTS[0]?.commandId === 'theme.toggle' &&
    GLOBAL_SHORTCUTS[1]?.commandId === 'file.openFolder',
  'command ids aligned',
)

type Listener = (payload: never) => void
const listeners = new Map<string, Set<Listener>>()
const offs: Array<() => void> = []

const host = {
  platform: 'web',
  app: {
    on: (event: string, listener: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
      const off = (): void => {
        listeners.get(event)?.delete(listener)
      }
      offs.push(off)
      return off
    },
  },
} as never as import('@markup/host-api').HostAPI

const seen: string[] = []
const off = attachHostEvents(host, {
  onMenuCommand: (id) => seen.push(`menu:${id}`),
  onGlobalShortcut: (id) => seen.push(`shortcut:${id}`),
  onOsTheme: (theme) => seen.push(`os:${theme}`),
  onFileOpen: (path) => seen.push(`open:${path}`),
})

function emit(event: string, payload: unknown): void {
  for (const listener of listeners.get(event) ?? []) {
    ;(listener as (p: unknown) => void)(payload)
  }
}

assert(listeners.get('menu-command')?.size === 1, 'menu-command subscribed')
assert(listeners.get('global-shortcut')?.size === 1, 'global-shortcut subscribed')
assert(listeners.get('os-theme')?.size === 1, 'os-theme subscribed')
assert(listeners.get('file-open')?.size === 1, 'file-open subscribed')

emit('menu-command', 'file.save')
emit('global-shortcut', 'theme.toggle')
emit('os-theme', 'dark')
emit('file-open', 'C:/doc/readme.md')
assert(
  seen.join(',') === 'menu:file.save,shortcut:theme.toggle,os:dark,open:C:/doc/readme.md',
  `seen: ${seen.join(',')}`,
)

off()
assert(listeners.get('menu-command')?.size === 0, 'menu-command unsubscribed')
assert(listeners.get('global-shortcut')?.size === 0, 'global-shortcut unsubscribed')
assert(listeners.get('os-theme')?.size === 0, 'os-theme unsubscribed')
assert(listeners.get('file-open')?.size === 0, 'file-open unsubscribed')

emit('menu-command', 'file.save')
assert(seen.filter((s) => s.startsWith('menu:')).length === 1, 'no fire after off')

console.log('SMOKE UI HOST EVENTS OK: attach/unsubscribe + systemThemeClass')
