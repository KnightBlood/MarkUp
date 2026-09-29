export interface Command {
  id: string
  label: string
  shortcut?: string
  run: () => void
}

export class CommandRegistry {
  private commands = new Map<string, Command>()
  /**
   * User rebound shortcuts, `''` meaning "explicitly unbound". Only the
   * in-app keymap follows these; native menus keep their default accelerators.
   */
  private overrides = new Map<string, string>()
  /** While rebinding in settings, the global keymap must not fire commands. */
  private suspended = false

  register(command: Command): void {
    this.commands.set(command.id, command)
  }

  get(id: string): Command | undefined {
    return this.commands.get(id)
  }

  /** Effective shortcuts (overrides applied) — used by palette / keymap / UI. */
  list(): Command[] {
    return [...this.commands.values()].map((command) => ({
      ...command,
      shortcut: this.shortcutFor(command.id),
    }))
  }

  /** The shortcut the keymap would fire for `id` (undefined = unbound). */
  shortcutFor(id: string): string | undefined {
    const command = this.commands.get(id)
    if (!command) return undefined
    if (this.overrides.has(id)) {
      const value = this.overrides.get(id) ?? ''
      return value === '' ? undefined : value
    }
    return command.shortcut
  }

  /** Shipped binding, ignoring user overrides (settings "恢复默认"). */
  defaultShortcut(id: string): string | undefined {
    return this.commands.get(id)?.shortcut
  }

  /** True when the user rebound or unbound this command. */
  isCustomized(id: string): boolean {
    return this.overrides.has(id)
  }

  /**
   * Rebind: a shortcut string, `''` to unbind, `null` to restore the default.
   * Unknown ids are ignored.
   */
  setShortcut(id: string, shortcut: string | null): void {
    if (!this.commands.has(id)) return
    if (shortcut === null) this.overrides.delete(id)
    else this.overrides.set(id, shortcut)
  }

  applyOverrides(overrides: Record<string, string> | undefined): void {
    this.overrides.clear()
    for (const [id, shortcut] of Object.entries(overrides ?? {})) {
      if (this.commands.has(id) && typeof shortcut === 'string') {
        this.overrides.set(id, shortcut)
      }
    }
  }

  getOverrides(): Record<string, string> {
    return Object.fromEntries(this.overrides)
  }

  /** Command currently bound to `shortcut` (for conflict reporting). */
  findByShortcut(shortcut: string, exceptId?: string): Command | undefined {
    for (const command of this.commands.values()) {
      if (command.id === exceptId) continue
      if (this.shortcutFor(command.id) === shortcut) return command
    }
    return undefined
  }

  run(id: string): void {
    this.commands.get(id)?.run()
  }

  /** Suspend global key dispatch while a shortcut is being captured. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended
  }

  isSuspended(): boolean {
    return this.suspended
  }

  unregister(id: string): boolean {
    this.overrides.delete(id)
    return this.commands.delete(id)
  }
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const source = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`
  return /mac|iphone|ipad|ipod/i.test(source)
}

export function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing) return null
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return null
  const parts = ['Mod']
  if (event.shiftKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')
  let key = event.key
  if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}

export function formatShortcut(shortcut: string | undefined): string {
  if (!shortcut) return ''
  const mac = isMacPlatform()
  return shortcut
    .replace(/Mod/g, mac ? '⌘' : 'Ctrl')
    .replace(/Shift/g, mac ? '⇧' : 'Shift')
    .replace(/Alt/g, mac ? '⌥' : 'Alt')
    .replace(/\+/g, mac ? '' : '+')
}

export function attachKeydown(registry: CommandRegistry): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    if (registry.isSuspended()) return
    const shortcut = shortcutFromEvent(event)
    if (!shortcut) return
    const hit = registry.list().find((command) => command.shortcut === shortcut)
    if (!hit) return
    event.preventDefault()
    event.stopPropagation()
    hit.run()
  }
  window.addEventListener('keydown', onKeydown, true)
  return () => {
    window.removeEventListener('keydown', onKeydown, true)
  }
}
