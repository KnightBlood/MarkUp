/**
 * Which way the shell is currently painted, for guests that ship their own
 * palette (file-viewer, mermaid, mathlive …) and can only be told
 * "light" or "dark".
 *
 * Deliberately not keyed off the theme class. Three of the five themes would
 * be mis-read that way:
 *   - `github` / `github-dark` never carry a `theme-dark` class, so a class
 *     check sends them to the OS preference instead of their own palette;
 *   - `custom` paints through inline `--bg` on `<html>`, invisible to class.
 * Reading the computed `--bg` covers all of them, and picks up any theme
 * added later without touching this file.
 */

export type ShellThemeMode = 'light' | 'dark'

/** Perceptual brightness, 0..1. A threshold check, not WCAG luminance. */
function brightness(color: string): number {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim())
  const raw = match?.[1]
  if (!raw) return 0.5
  const hex = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw
  const int = parseInt(hex.slice(0, 6), 16)
  const r = (int >> 16) & 0xff
  const g = (int >> 8) & 0xff
  const b = int & 0xff
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

export function shellThemeMode(): ShellThemeMode {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  // No token resolved (stylesheet not applied yet) — the OS preference is the
  // least surprising guess. Guarded the way shell.ts guards it: jsdom ships no
  // matchMedia, and a bare call there throws out of every guest that only
  // wanted a `light`/`dark` word.
  if (!bg) {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  }
  return brightness(bg) < 0.5 ? 'dark' : 'light'
}
