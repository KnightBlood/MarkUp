import type { AppConfig } from '@markup/host-api'

/**
 * Theme metadata — the single source for the settings dropdown, the
 * status-bar cycle order and the `<html>` classes. Adding a theme means
 * touching this file plus the token block in `theme/tokens.css`.
 */

/** Every theme class that may sit on `<html>` (kept together for removal). */
export const THEME_CLASSES = [
  'theme-light',
  'theme-dark',
  'theme-custom',
  'theme-github',
  'theme-github-dark',
] as const

export const THEME_OPTIONS: Array<{ value: AppConfig['theme']; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'github', label: 'GitHub 浅色' },
  { value: 'github-dark', label: 'GitHub 深色' },
  { value: 'custom', label: '自定义' },
]

/** Cycle order used by `theme.toggle` / the status-bar theme label. */
export const THEME_ORDER: AppConfig['theme'][] = [
  'light',
  'dark',
  'github',
  'github-dark',
  'system',
  'custom',
]

export const THEME_LABELS: Record<AppConfig['theme'], string> = {
  system: 'system',
  light: 'light',
  dark: 'dark',
  github: 'github',
  'github-dark': 'github-dark',
  custom: 'custom',
}

/**
 * `<html>` class for an explicit theme. `system` resolves through the OS
 * preference instead (see `systemThemeClass`), so it maps to `null` here.
 */
export function themeClass(theme: AppConfig['theme']): string | null {
  switch (theme) {
    case 'light':
      return 'theme-light'
    case 'dark':
      return 'theme-dark'
    case 'github':
      return 'theme-github'
    case 'github-dark':
      return 'theme-github-dark'
    case 'custom':
      return 'theme-custom'
    default:
      return null
  }
}

/**
 * Font custom properties for a config; `value: null` means "use the default".
 *
 * The built-in stack is appended as a fallback rather than replaced: a family
 * list naming a font that is not installed must not strip every fallback
 * (tokens.css keeps the stacks in `--font-*-default`).
 */
export function fontVars(config: AppConfig): Array<{ name: string; value: string | null }> {
  const body = (config.bodyFont ?? '').trim()
  const code = (config.codeFont ?? '').trim()
  return [
    { name: '--font-ui', value: body ? `${body}, var(--font-ui-default)` : null },
    { name: '--font-editor', value: code ? `${code}, var(--font-editor-default)` : null },
  ]
}
