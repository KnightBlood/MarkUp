import { getHost } from '@markup/host-api'
import type { Anchor } from '@markup/core'
import { el } from '../dom'
import { extractOutline, type OutlineItem } from '../outline'
import type { ContextMenuItem } from './contextMenu'
import {
  basename,
  collectSearchTargets,
  relativePath,
  searchInFiles,
  type SearchHit,
  type WorkspaceState,
} from '../workspace'

export interface SidebarHandlers {
  onOpen: (path: string, content: string) => void
  openPath: (path: string) => Promise<void>
  getCurrentPath: () => string | null
  getMarkdown: () => string
  gotoAnchor: (anchor: Anchor) => void
  getWorkspace: () => WorkspaceState
  onOpenFolder: () => Promise<void>
  getRecents: () => Promise<string[]>
  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void
  copyText?: (text: string) => Promise<void>
  removeFromRecents?: (path: string) => Promise<void>
}

export interface SidebarApi {
  el: HTMLElement
  refreshOutline: () => void
  refreshRecents: () => void
  refreshWorkspace: () => void
  showTab: (tab: string) => void
  focusSearch: () => void
  /** Append a plugin tab (button + panel). Returns an unsubscribe that removes it. */
  registerTab: (spec: SidebarTabSpec) => () => void
}

export type SidebarTab = 'file' | 'outline' | 'search'

/** Extra sidebar tab contributed at runtime (plugins / registration surface). */
export interface SidebarTabSpec {
  id: string
  label: string
  render: () => HTMLElement
}

export async function pickMarkdownFile(): Promise<{ path: string; content: string } | null> {
  const host = getHost()
  try {
    const picked = await host.dialog.open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    })
    const first = picked[0]
    if (!first) return null
    const { content } = await host.fs.read(first.path)
    return { path: first.path, content }
  } catch (error) {
    console.error('[markup] open failed', error)
    await host.dialog
      .message({ title: 'Markup', message: `打开文件失败：${String(error)}` })
      .catch(() => undefined)
    return null
  }
}

export function renderSidebar(handlers: SidebarHandlers): SidebarApi {
  const host = getHost()
  let tab = 'file'
  let recents: string[] = []
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchToken = 0
  let searchCase = false
  let searchRegex = false
  let outlineItems: OutlineItem[] = []
  let searchHits: SearchHit[] = []

  const tabFileBtn = el('button', { class: 'sidebar__tab is-active', type: 'button', text: '文件' })
  const tabOutlineBtn = el('button', { class: 'sidebar__tab', type: 'button', text: '大纲' })
  const tabSearchBtn = el('button', { class: 'sidebar__tab', type: 'button', text: '搜索' })

  const fileList = el('ul', { class: 'file-tree' })
  const openBtn = el('button', { class: 'btn', type: 'button', text: '打开文件…' })
  const openFolderBtn = el('button', { class: 'btn', type: 'button', text: '打开文件夹…' })
  const workspaceLabel = el('div', { class: 'sidebar__workspace', hidden: true })
  const filePanel = el(
    'div',
    { class: 'sidebar__panel' },
    el('div', { class: 'sidebar__tools' }, openBtn, openFolderBtn),
    workspaceLabel,
    fileList,
  )

  const outlineList = el('ul', { class: 'outline' })
  const outlinePanel = el('div', { class: 'sidebar__panel', hidden: true }, outlineList)

  const searchInput = el('input', {
    class: 'search-panel__input',
    type: 'search',
    placeholder: '在工作区/最近文件中搜索…',
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const caseBtn = el('button', {
    class: 'search-panel__toggle',
    type: 'button',
    text: 'Aa',
    title: '区分大小写',
  })
  const regexBtn = el('button', {
    class: 'search-panel__toggle',
    type: 'button',
    text: '.*',
    title: '正则表达式',
  })
  const searchStatus = el('div', { class: 'search-panel__status', text: '输入关键词开始搜索' })
  const searchList = el('div', { class: 'search-results' })
  const searchPanel = el(
    'div',
    { class: 'sidebar__panel search-panel', hidden: true },
    el('div', { class: 'sidebar__tools search-panel__tools' }, searchInput),
    el('div', { class: 'search-panel__toggles' }, caseBtn, regexBtn, searchStatus),
    searchList,
  )

  const tabs = el('div', { class: 'sidebar__tabs' }, tabFileBtn, tabOutlineBtn, tabSearchBtn)

  const tabButtons = new Map<string, HTMLButtonElement>([
    ['file', tabFileBtn],
    ['outline', tabOutlineBtn],
    ['search', tabSearchBtn],
  ])
  const panels = new Map<string, HTMLElement>([
    ['file', filePanel],
    ['outline', outlinePanel],
    ['search', searchPanel],
  ])

  const showTab = (next: string): void => {
    tab = next
    for (const [id, button] of tabButtons) button.classList.toggle('is-active', id === next)
    for (const [id, panel] of panels) panel.hidden = id !== next
  }

  tabFileBtn.addEventListener('click', () => showTab('file'))
  tabOutlineBtn.addEventListener('click', () => showTab('outline'))
  tabSearchBtn.addEventListener('click', () => {
    showTab('search')
    searchInput.focus()
  })

  openBtn.addEventListener('click', () => {
    void (async () => {
      const picked = await pickMarkdownFile()
      if (picked) handlers.onOpen(picked.path, picked.content)
    })()
  })

  openFolderBtn.addEventListener('click', () => {
    void handlers.onOpenFolder()
  })

  const openWorkspaceFile = (path: string): void => {
    void handlers.openPath(path)
  }

  const refreshWorkspaceFiles = (): void => {
    const workspace = handlers.getWorkspace()
    if (!workspace.root) {
      workspaceLabel.hidden = true
      workspaceLabel.textContent = ''
      renderRecents()
      return
    }
    workspaceLabel.hidden = false
    workspaceLabel.textContent = `${relativePath(workspace.root, workspace.root) || basename(workspace.root)} · ${workspace.files.length} 个 md`
    workspaceLabel.title = workspace.root

    if (workspace.files.length === 0) {
      fileList.replaceChildren(
        el('li', { class: 'file-tree__empty', text: '工作区内暂无 Markdown 文件' }),
      )
      return
    }
    fileList.replaceChildren(
      ...workspace.files.map((path) =>
        el(
          'li',
          {},
          el('button', {
            class: 'file-tree__recent',
            type: 'button',
            text: relativePath(workspace.root!, path),
            title: path,
            onclick: () => openWorkspaceFile(path),
          }),
        ),
      ),
    )
  }

  const renderRecents = (): void => {
    if (recents.length === 0) {
      fileList.replaceChildren(el('li', { class: 'file-tree__empty', text: '暂无最近文件' }))
      return
    }
    fileList.replaceChildren(
      ...recents.map((path) =>
        el(
          'li',
          {},
          el('button', {
            class: 'file-tree__recent',
            type: 'button',
            text: basename(path),
            title: path,
            onclick: () => openWorkspaceFile(path),
          }),
        ),
      ),
    )
  }

  const refreshRecents = (): void => {
    void (async () => {
      recents = await handlers.getRecents().catch(() => [])
      if (!handlers.getWorkspace().root) renderRecents()
      else refreshWorkspaceFiles()
    })()
  }

  const refreshWorkspace = (): void => {
    refreshWorkspaceFiles()
  }

  const refreshOutline = (): void => {
    const items = extractOutline(handlers.getMarkdown())
    outlineItems = items
    if (items.length === 0) {
      outlineList.replaceChildren(el('li', { class: 'outline__empty', text: '无标题' }))
      return
    }
    outlineList.replaceChildren(
      ...items.map((item) =>
        el(
          'li',
          {},
          el('button', {
            class: 'outline__item',
            type: 'button',
            text: item.text,
            title: `第 ${item.line} 行`,
            style: `padding-left: ${8 + (item.level - 1) * 12}px`,
            onclick: () => handlers.gotoAnchor({ offset: item.offset, line: item.line }),
          }),
        ),
      ),
    )
  }

  const runSearch = (): void => {
    const query = searchInput.value
    if (!query.trim()) {
      searchStatus.textContent = '输入关键词开始搜索'
      searchList.replaceChildren()
      return
    }
    const token = ++searchToken
    searchStatus.textContent = '搜索中…'
    void (async () => {
      const workspace = handlers.getWorkspace()
      const targets = collectSearchTargets(workspace, recents)
      if (targets.length === 0) {
        searchStatus.textContent = '无搜索范围（先打开文件夹或文件）'
        searchList.replaceChildren()
        return
      }
      try {
        const hits = await searchInFiles({
          query,
          caseSensitive: searchCase,
          useRegex: searchRegex,
          paths: targets,
        })
        if (token !== searchToken) return
        searchHits = hits
        searchStatus.textContent = `${hits.length} 处匹配 · ${targets.length} 个文件`
        if (hits.length === 0) {
          searchList.replaceChildren(el('div', { class: 'search-results__empty', text: '无结果' }))
          return
        }
        searchList.replaceChildren(
          ...hits.slice(0, 200).map((hit) =>
            el(
              'button',
              {
                class: 'search-results__item',
                type: 'button',
                onclick: () => openHit(hit),
                title: `${hit.path}:${hit.line}`,
              },
              el('span', {
                class: 'search-results__meta',
                text: `${basename(hit.path)}:${hit.line}`,
              }),
              el('span', { class: 'search-results__preview', text: hit.preview }),
            ),
          ),
        )
      } catch (error) {
        console.error('[markup] search failed', error)
        if (token === searchToken) {
          searchStatus.textContent = `搜索失败：${String(error)}`
        }
      }
    })()
  }

  const openHit = (hit: SearchHit): void => {
    void (async () => {
      const current = handlers.getCurrentPath()
      if (current !== hit.path) {
        await handlers.openPath(hit.path)
      }
      handlers.gotoAnchor({
        offset: hit.offset,
        line: hit.line,
        endOffset: hit.offset + Math.max(hit.length, 1),
      })
      searchStatus.textContent = `跳转 ${basename(hit.path)}:${hit.line}`
    })()
  }

  searchInput.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(runSearch, 220)
  })

  caseBtn.addEventListener('click', () => {
    searchCase = !searchCase
    caseBtn.classList.toggle('is-active', searchCase)
    runSearch()
  })

  regexBtn.addEventListener('click', () => {
    searchRegex = !searchRegex
    regexBtn.classList.toggle('is-active', searchRegex)
    runSearch()
  })

  refreshRecents()
  refreshOutline()

  const copy = (text: string): void => {
    void handlers.copyText?.(text)
  }

  const fileMenuItems = (path: string, canRemove: boolean): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: '打开', run: () => openWorkspaceFile(path) },
      { label: '复制路径', run: () => copy(path) },
    ]
    if (canRemove) {
      items.push(
        { separator: true },
        {
          label: '从最近列表移除',
          run: () => void handlers.removeFromRecents?.(path),
        },
      )
    }
    return items
  }

  const outlineMenuItems = (item: OutlineItem): ContextMenuItem[] => [
    {
      label: '跳转到标题',
      run: () => handlers.gotoAnchor({ offset: item.offset, line: item.line }),
    },
    { label: '复制标题文本', run: () => copy(item.text) },
    {
      label: '复制 Markdown 链接',
      run: () => copy(`[${item.text}](#${item.line})`),
    },
  ]

  const searchMenuItems = (hit: SearchHit): ContextMenuItem[] => [
    { label: '打开并跳转', run: () => openHit(hit) },
    { label: '复制路径', run: () => copy(hit.path) },
    { label: '复制位置', run: () => copy(`${hit.path}:${hit.line}`) },
    { label: '复制匹配行', run: () => copy(hit.preview) },
  ]

  const root = el('aside', { class: 'sidebar' }, tabs, filePanel, outlinePanel, searchPanel)

  const registerTab = (spec: SidebarTabSpec): (() => void) => {
    if (tabButtons.has(spec.id)) throw new Error(`sidebar tab already registered: ${spec.id}`)
    const button = el('button', {
      class: 'sidebar__tab',
      type: 'button',
      text: spec.label,
      onclick: () => showTab(spec.id),
    })
    const panel = spec.render()
    panel.hidden = tab !== spec.id
    tabs.appendChild(button)
    root.appendChild(panel)
    tabButtons.set(spec.id, button)
    panels.set(spec.id, panel)
    return () => {
      button.remove()
      panel.remove()
      tabButtons.delete(spec.id)
      panels.delete(spec.id)
      if (tab === spec.id) showTab('file')
    }
  }

  root.addEventListener('contextmenu', (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return

    const fileBtn = target.closest<HTMLButtonElement>('.file-tree__recent')
    if (fileBtn) {
      event.preventDefault()
      const path = fileBtn.title || fileBtn.textContent || ''
      if (!path) return
      const inWorkspace = Boolean(handlers.getWorkspace().root)
      handlers.showContextMenu(
        event.clientX,
        event.clientY,
        fileMenuItems(path, !inWorkspace || recents.includes(path)),
      )
      return
    }

    const outlineBtn = target.closest<HTMLButtonElement>('.outline__item')
    if (outlineBtn) {
      event.preventDefault()
      const index = Array.from(outlineList.querySelectorAll('.outline__item')).indexOf(outlineBtn)
      const item = outlineItems[index]
      if (item) handlers.showContextMenu(event.clientX, event.clientY, outlineMenuItems(item))
      return
    }

    const searchBtn = target.closest<HTMLButtonElement>('.search-results__item')
    if (searchBtn) {
      event.preventDefault()
      const index = Array.from(searchList.querySelectorAll('.search-results__item')).indexOf(
        searchBtn,
      )
      const hit = searchHits[index]
      if (hit) handlers.showContextMenu(event.clientX, event.clientY, searchMenuItems(hit))
      return
    }

    if (target.closest('.search-panel__input, .sidebar__tools, .sidebar__tabs')) return

    const showBlank = target.closest('.file-tree, .outline, .search-results, .sidebar__panel')
    if (!showBlank) return
    event.preventDefault()
    const workspace = handlers.getWorkspace()
    handlers.showContextMenu(event.clientX, event.clientY, [
      { label: '打开文件…', run: () => openBtn.click() },
      { label: '打开文件夹…', run: () => openFolderBtn.click() },
      ...(workspace.root
        ? [
            { separator: true } as ContextMenuItem,
            { label: '刷新工作区列表', run: () => refreshWorkspace() },
          ]
        : []),
    ])
  })

  return {
    el: root,
    refreshOutline,
    refreshRecents,
    refreshWorkspace,
    showTab,
    registerTab,
    focusSearch: () => {
      showTab('search')
      searchInput.focus()
      searchInput.select()
    },
  }
}
