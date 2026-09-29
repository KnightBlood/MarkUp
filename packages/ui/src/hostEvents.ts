import type { HostAPI } from '@markup/host-api'

export interface HostEventHandlers {
  onMenuCommand: (commandId: string) => void
  onGlobalShortcut: (commandId: string) => void
  onOsTheme: (theme: 'light' | 'dark') => void
}

/** Subscribe to host events; returns an unsubscribe that clears all listeners. */
export function attachHostEvents(host: HostAPI, handlers: HostEventHandlers): () => void {
  const offs = [
    host.app.on('menu-command', handlers.onMenuCommand),
    host.app.on('global-shortcut', handlers.onGlobalShortcut),
    host.app.on('os-theme', handlers.onOsTheme),
  ]
  return () => {
    for (const off of offs) off()
  }
}

/**
 * Resolve explicit theme class for `theme: 'system'`.
 * Prefer host-reported `osTheme`; fall back to `prefers-color-scheme`.
 */
export function systemThemeClass(
  osTheme: 'light' | 'dark' | null,
  prefersDark?: boolean,
): 'theme-dark' | 'theme-light' {
  if (osTheme === 'dark') return 'theme-dark'
  if (osTheme === 'light') return 'theme-light'
  return prefersDark === true ? 'theme-dark' : 'theme-light'
}
