import type { DirEntry, HostAPI } from '@markup/host-api'
import type { Command } from './commands'
import type { ContextItemProvider, ShellHandle } from './shell'
import type { SidebarTabSpec } from './ui/sidebar'
import type { SettingsTabSpec } from './ui/settings'

export interface PluginManifest {
  id: string
  name: string
  version: string
  /** Entry file inside the plugin folder (default: index.js). */
  main?: string
  /** Shown in the settings → 插件 list. */
  description?: string
  /**
   * Declared capabilities — ungranted API surfaces throw `permission denied`.
   * Known ids: 'document' (api.doc), 'fs' (host.fs), 'dialog' (host.dialog),
   * 'config' (host.app.getConfig/setConfig). Unknown ids are reported as warnings.
   */
  permissions?: string[]
  /**
   * Host compatibility: `{ hostApi: <major> }` must equal `PLUGIN_API_VERSION`,
   * otherwise the plugin is reported as an error and never executed.
   * Omitted = "works with any version" (pre-engines plugins keep loading).
   */
  engines?: { hostApi?: number }
}

/**
 * Version of the plugin host surface (`PluginAPI` + loader contract) this build
 * provides. Bump on breaking changes to PluginAPI/manifest semantics.
 */
export const PLUGIN_API_VERSION = 1

/** Capabilities a plugin may declare; everything else is rejected with a warning. */
export const KNOWN_PERMISSIONS = ['document', 'fs', 'dialog', 'config'] as const
export type PluginPermission = (typeof KNOWN_PERMISSIONS)[number]

/** Command surface handed to plugins (records ids so deactivate can unregister them). */
export interface PluginCommands {
  register(command: Command): void
  get(id: string): Command | undefined
  list(): Command[]
  run(id: string): void
  unregister(id: string): void
}

/** Caret/selection as 0-based character offsets into the markdown text (to exclusive, clamped). */
export interface DocCursor {
  from: number
  to: number
}

/** Read/write access to the active document (the editor pane behind the shell). */
export interface PluginDocument {
  getMarkdown(): string
  /** Replace the whole document (goes through the normal change pipeline). */
  setMarkdown(markdown: string): void
  /** Insert at the caret — replaces the selection when one is active. */
  insertMarkdown(markdown: string): void
  getSelectedText(): string
  focus(): void
  /** Load a file into the editor (reads via host.fs, becomes the active document). False when unreadable. */
  open(path: string): Promise<boolean>
  /** Absolute path of the active document; null/'' when never saved (unsaved buffer). */
  getPath(): string | null
  /** Current caret/selection offsets; null when no editor surface is mounted. */
  getCursor(): DocCursor | null
  /** Set the selection (to omitted = collapse caret at from). False when unavailable. */
  setSelection(from: number, to?: number): boolean
}

export interface PluginNotifyOptions {
  level?: 'info' | 'warn' | 'error'
  /** Auto-dismiss in ms; 0 keeps until clicked. */
  timeout?: number
}

/** Statusbar slots for plugins — same id keeps one slot (updates in place). */
export interface PluginStatusbar {
  set(id: string, text: string, title?: string): () => void
  remove(id: string): void
}

/**
 * The only object a plugin receives — no DOM, no raw registry.
 * Everything registered through it is torn down by `deactivate()`.
 */
export interface PluginAPI {
  commands: PluginCommands
  host: HostAPI
  /** Active document (editor pane). */
  doc: PluginDocument
  /** Short-lived host toast (bottom-right, auto-dismiss). */
  notify(message: string, options?: PluginNotifyOptions): void
  /** Dynamic statusbar items. */
  statusbar: PluginStatusbar
  /** Read-only workspace context: open folder root, null when none. */
  workspace: { root: string | null }
  registerContextItem: ShellHandle['registerContextItem']
  registerSidebarTab: ShellHandle['registerSidebarTab']
  registerSettingsTab: ShellHandle['registerSettingsTab']
}

export interface LoadedPlugin {
  manifest: PluginManifest
  /** Runs the plugin's own teardown (returned function) and unregisters everything it added. */
  deactivate: () => void
}

export interface LoadPluginsResult {
  loaded: LoadedPlugin[]
  /** Manifests found on disk but skipped because their id is disabled — settings shows them as off. */
  disabled: PluginManifest[]
  /** Non-fatal problems (e.g. unknown permission ids in a manifest). */
  warnings: string[]
  errors: Array<{ source: string; error: string }>
  /** Each existing plugin root + its plugin folders — shell watches these for hot reload. Empty when nothing was scanned. */
  watchDirs: string[]
}

export interface LoadPluginsOptions {
  host: HostAPI
  /** Shell command registry — plugin commands join the palette/shortcuts/menu self-check. */
  commands: {
    register(command: Command): void
    unregister(id: string): boolean
    get(id: string): Command | undefined
    list(): Command[]
    run(id: string): void
  }
  /** Active document handed to plugins as `api.doc`. */
  document: PluginDocument
  /** Plugin ids the user disabled — their manifest is read (for the settings list) but code never runs. */
  disabled?: readonly string[]
  /** Host toast sink (shell wires it to the toast UI; omitted = silent no-op). */
  notify?: (message: string, options?: PluginNotifyOptions) => void
  /** Host statusbar sink (shell wires it to dynamic statusbar slots). */
  statusbar?: PluginStatusbar
  /** Workspace folder root, live (shell re-evaluates on folder switch; null = none). */
  getWorkspaceRoot?: () => string | null
  context: Pick<
    ShellHandle,
    'registerContextItem' | 'registerSidebarTab' | 'registerSettingsTab'
  >
}

/**
 * Scan both plugin roots — `~/.markup/plugins` (user-global, identical
 * across shells) and `<程序目录>/plugins` (next to the executable, resolved
 * absolute) — and run each `<root>/<name>/{manifest.json,index.js}` plugin.
 * Same id in both roots: the user-global copy wins (first occurrence claims
 * the id). A root that cannot be read (pluginsLocal is never created on
 * demand) is skipped without failing the other. Local trusted plugins (same
 * process, no sandbox) — see README. A host without `app.getPath` (web)
 * yields an empty result instead of an error.
 */
export async function loadPlugins(options: LoadPluginsOptions): Promise<LoadPluginsResult> {
  const { host, commands, document: doc, context, disabled } = options
  const disabledIds = new Set(disabled ?? [])
  const loaded: LoadedPlugin[] = []
  const disabledManifests: PluginManifest[] = []
  const warnings: string[] = []
  const errors: LoadPluginsResult['errors'] = []
  const watchDirs: string[] = []
  const fail = (source: string, error: unknown): void => {
    errors.push({ source, error: error instanceof Error ? error.message : String(error) })
  }
  const done = (): LoadPluginsResult => ({
    loaded,
    disabled: disabledManifests,
    warnings,
    errors,
    watchDirs,
  })

  if (!host.app.getPath) return done()
  // Global root first so its manifest wins when the same id also exists next
  // to the program — the first occurrence of an id is the one that loads.
  const roots: string[] = []
  for (const kind of ['plugins', 'pluginsLocal'] as const) {
    try {
      const path = await host.app.getPath(kind)
      if (path && !roots.includes(path)) roots.push(path)
    } catch (error) {
      fail(kind, error)
    }
  }
  if (roots.length === 0) return done()

  const pluginDirs: string[] = []
  for (const root of roots) {
    let entries: DirEntry[]
    try {
      entries = await host.fs.readDir(root)
    } catch {
      // Missing root (pluginsLocal is never created on demand) or unreadable
      // — keep scanning the other one.
      continue
    }
    watchDirs.push(root)
    for (const entry of entries) {
      if (entry.kind === 'dir') {
        watchDirs.push(entry.path)
        pluginDirs.push(entry.path)
      }
    }
  }

  const seenIds = new Set<string>()
  for (const source of pluginDirs) {
    try {
      const manifestRaw = await host.fs.read(`${source}/manifest.json`)
      const manifest = JSON.parse(manifestRaw.content) as PluginManifest
      if (!manifest?.id?.trim() || !manifest?.name?.trim() || !manifest?.version?.trim()) {
        throw new Error('manifest missing id/name/version')
      }
      if (seenIds.has(manifest.id)) continue // duplicate id — the earlier (user-global) root won
      seenIds.add(manifest.id)
      if (disabledIds.has(manifest.id)) {
        disabledManifests.push(manifest)
        continue
      }
      if (manifest.engines?.hostApi !== undefined && manifest.engines.hostApi !== PLUGIN_API_VERSION) {
        throw new Error(
          `incompatible hostApi ${String(manifest.engines.hostApi)} (host provides ${PLUGIN_API_VERSION})`,
        )
      }
      const granted = new Set<string>()
      for (const permission of manifest.permissions ?? []) {
        if ((KNOWN_PERMISSIONS as readonly string[]).includes(permission)) granted.add(permission)
        else warnings.push(`${manifest.id}: unknown permission "${permission}"`)
      }
      const mainFile = await host.fs.read(`${source}/${manifest.main ?? 'index.js'}`)

      const deny =
        (permission: PluginPermission) =>
        (): never => {
          throw new Error(
            `plugin permission denied: ${permission} (declare "permissions": ["${permission}"] in manifest)`,
          )
        }
      const gatedHost: HostAPI = granted.has('fs') && granted.has('dialog') && granted.has('config')
        ? host
        : ({
            ...host,
            fs: granted.has('fs')
              ? host.fs
              : {
                  read: deny('fs'),
                  write: deny('fs'),
                  readDir: deny('fs'),
                  watch: deny('fs'),
                  readBase64: deny('fs'),
                },
            dialog: granted.has('dialog')
              ? host.dialog
              : { open: deny('dialog'), save: deny('dialog'), message: deny('dialog') },
            app: {
              ...host.app,
              getConfig: granted.has('config') ? host.app.getConfig : deny('config'),
              setConfig: granted.has('config') ? host.app.setConfig : deny('config'),
            },
          } satisfies HostAPI)
      const gatedDoc: PluginDocument = granted.has('document')
        ? doc
        : {
            getMarkdown: deny('document'),
            setMarkdown: deny('document'),
            insertMarkdown: deny('document'),
            getSelectedText: deny('document'),
            focus: deny('document'),
            open: deny('document'),
            getPath: deny('document'),
            getCursor: deny('document'),
            setSelection: deny('document'),
          }

      const commandIds: string[] = []
      const subs: Array<() => void> = []
      const statusbar: PluginStatusbar = options.statusbar ?? {
        set: () => () => undefined,
        remove: () => undefined,
      }
      const api: PluginAPI = {
        host: gatedHost,
        doc: gatedDoc,
        notify: options.notify ?? (() => undefined),
        statusbar: {
          set: (id, text, title) => statusbar.set(id, text, title),
          remove: (id) => statusbar.remove(id),
        },
        workspace: {
          get root() {
            return options.getWorkspaceRoot?.() ?? null
          },
        },
        commands: {
          register: (command) => {
            commands.register(command)
            commandIds.push(command.id)
          },
          get: (id) => commands.get(id),
          list: () => commands.list(),
          run: (id) => commands.run(id),
          unregister: (id) => {
            commandIds.push(id)
            commands.unregister(id)
          },
        },
        registerContextItem: (provider: ContextItemProvider) => {
          const off = context.registerContextItem(provider)
          subs.push(off)
          return off
        },
        registerSidebarTab: (spec: SidebarTabSpec) => {
          const off = context.registerSidebarTab(spec)
          subs.push(off)
          return off
        },
        registerSettingsTab: (spec: SettingsTabSpec) => {
          const off = context.registerSettingsTab(spec)
          subs.push(off)
          return off
        },
      }

      // Trusted local plugin: evaluated with only `api` in scope (no require/import).
      const runner = new Function('api', `"use strict";\n${mainFile.content}`) as (
        api: PluginAPI,
      ) => unknown
      const returned = runner(api)
      let teardown: unknown = returned

      loaded.push({
        manifest,
        deactivate: () => {
          try {
            const result = typeof teardown === 'function' ? teardown() : undefined
            if (result instanceof Promise) result.catch((error) => fail(`${source}:teardown`, error))
          } catch (error) {
            fail(`${source}:teardown`, error)
          }
          teardown = null
          for (const id of commandIds.splice(0)) commands.unregister(id)
          for (const off of subs.splice(0).reverse()) {
            try {
              off()
            } catch (error) {
              fail(`${source}:unsubscribe`, error)
            }
          }
        },
      })
    } catch (error) {
      fail(source, error)
    }
  }
  return done()
}
