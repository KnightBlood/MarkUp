import type { AppConfig, CustomTheme } from '@markup/host-api'
import { el } from '../dom'

export type SettingsTab = 'appearance' | 'editor' | 'view'

/** Extra settings tab contributed at runtime (plugins / registration surface). */
export interface SettingsTabSpec {
  id: string
  label: string
  render: () => HTMLElement
}

export interface SettingsApi {
  el: HTMLElement
  open: (tab?: string) => void
  close: () => void
  toggle: () => void
  isOpen: () => boolean
  getTab: () => string
  setTab: (tab: string) => void
  /** Append a plugin tab (button + panel). Returns an unsubscribe that removes it. */
  registerTab: (spec: SettingsTabSpec) => () => void
}

export interface SettingsCallbacks {
  getAppearance: () => AppConfig
  onAppearanceChange: (next: AppConfig) => void
  /** Called when the dialog closes (pending key capture must stop). */
  onClose?: () => void
}

const THEME_OPTIONS: Array<{ value: AppConfig['theme']; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'custom', label: '自定义' },
]

const COLOR_FIELDS: Array<{ key: keyof CustomTheme; label: string; fallback: string }> = [
  { key: 'bg', label: '背景', fallback: '#ffffff' },
  { key: 'bgSoft', label: '次背景', fallback: '#f6f7f9' },
  { key: 'bgRaise', label: '浮层背景', fallback: '#ffffff' },
  { key: 'fg', label: '文字', fallback: '#24292f' },
  { key: 'fgMuted', label: '次要文字', fallback: '#6e7781' },
  { key: 'border', label: '边框', fallback: '#d0d7de' },
  { key: 'accent', label: '强调色', fallback: '#0969da' },
  { key: 'accentFg', label: '强调前景', fallback: '#ffffff' },
  { key: 'ok', label: '成功', fallback: '#1a7f37' },
  { key: 'bad', label: '错误', fallback: '#cf222e' },
]

const TAB_LABELS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'appearance', label: '外观' },
  { id: 'editor', label: '编辑' },
  { id: 'view', label: '视图' },
]

function toHexColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  return value
}

function checked(input: HTMLInputElement): boolean {
  return input.checked
}

export function createSettings(callbacks: SettingsCallbacks): SettingsApi {
  const themeSelect = el('select', { class: 'settings__input' })
  for (const option of THEME_OPTIONS) {
    themeSelect.append(el('option', { value: option.value, text: option.label }))
  }

  const fontInput = el('input', {
    class: 'settings__input',
    type: 'number',
    min: '12',
    max: '28',
    step: '1',
  })
  const widthInput = el('input', {
    class: 'settings__input',
    type: 'number',
    min: '480',
    max: '1400',
    step: '10',
  })

  const autoSaveCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const autoSaveDelayInput = el('input', {
    class: 'settings__input',
    type: 'number',
    min: '300',
    max: '60000',
    step: '100',
  })
  const typewriterCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const restoreSessionCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const imagePasteCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const spellcheckCheck = el('input', { class: 'settings__check', type: 'checkbox' })

  const bodyFontInput = el('input', {
    class: 'settings__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const codeFontInput = el('input', {
    class: 'settings__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
  })

  const lineNumbersCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const showStatsCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const focusModeCheck = el('input', { class: 'settings__check', type: 'checkbox' })

  const colorRow = el('div', { class: 'settings__colors' })
  const colorInputs = new Map<keyof CustomTheme, HTMLInputElement>()
  for (const field of COLOR_FIELDS) {
    const input = el('input', { class: 'settings__color', type: 'color' })
    colorInputs.set(field.key, input)
    colorRow.append(
      el(
        'label',
        { class: 'settings__field settings__field--color' },
        el('span', { class: 'settings__label', text: field.label }),
        input,
      ),
    )
  }

  const colorSection = el(
    'section',
    { class: 'settings__section', 'data-section': 'custom-theme' },
    el('h3', { class: 'settings__heading', text: '自定义主题色' }),
    colorRow,
  )

  const appearancePanel = el(
    'div',
    { class: 'settings__panel-body', 'data-tab-panel': 'appearance' },
    el(
      'section',
      { class: 'settings__section' },
      el('h3', { class: 'settings__heading', text: '外观' }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '主题' }),
        themeSelect,
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '字号 (px)' }),
        fontInput,
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '编辑区宽度 (px)' }),
        widthInput,
      ),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'fonts' },
      el('h3', { class: 'settings__heading', text: '字体' }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '正文字体（界面与预览正文）' }),
        bodyFontInput,
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '代码字体（源码视图与代码块）' }),
        codeFontInput,
      ),
      el('p', {
        class: 'settings__label',
        text: '留空即恢复系统默认字体；可填 “Georgia, serif”、“JetBrains Mono” 等字体族。',
      }),
    ),
    colorSection,
  )

  const editorPanel = el(
    'div',
    { class: 'settings__panel-body', 'data-tab-panel': 'editor' },
    el(
      'section',
      { class: 'settings__section' },
      el('h3', { class: 'settings__heading', text: '编辑' }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        autoSaveCheck,
        el('span', { class: 'settings__label', text: '自动保存（有路径的文档）' }),
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '自动保存延时 (ms)' }),
        autoSaveDelayInput,
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        typewriterCheck,
        el('span', { class: 'settings__label', text: '打字机模式（光标行居中）' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        imagePasteCheck,
        el('span', { class: 'settings__label', text: '粘贴图片转为 Markdown' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        spellcheckCheck,
        el('span', { class: 'settings__label', text: '拼写检查' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        restoreSessionCheck,
        el('span', { class: 'settings__label', text: '重启后恢复上次打开的标签页' }),
      ),
    ),
  )

  const viewPanel = el(
    'div',
    { class: 'settings__panel-body', 'data-tab-panel': 'view' },
    el(
      'section',
      { class: 'settings__section' },
      el('h3', { class: 'settings__heading', text: '视图' }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        lineNumbersCheck,
        el('span', { class: 'settings__label', text: '分屏/源码视图显示行号' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        showStatsCheck,
        el('span', { class: 'settings__label', text: '状态栏显示字数统计' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        focusModeCheck,
        el('span', { class: 'settings__label', text: '专注模式（隐藏侧栏与状态栏）' }),
      ),
    ),
  )

  let current: AppConfig = callbacks.getAppearance()
  let activeTab = 'appearance'
  /** Set while a search hides the custom-theme section regardless of theme. */
  let colorSectionHiddenBySearch = false

  const tabButtons = new Map<string, HTMLButtonElement>()
  const tabNav = el(
    'nav',
    { class: 'settings__tabs', role: 'tablist', 'aria-label': '设置分类' },
    ...TAB_LABELS.map(({ id, label }) => {
      const button = el('button', {
        class: `settings__tab${id === activeTab ? ' is-active' : ''}`,
        type: 'button',
        role: 'tab',
        'data-tab': id,
        'aria-selected': id === activeTab ? 'true' : 'false',
        text: label,
        onclick: () => setTab(id),
      })
      tabButtons.set(id, button as HTMLButtonElement)
      return button
    }),
  )

  const panels = new Map<string, HTMLElement>([
    ['appearance', appearancePanel],
    ['editor', editorPanel],
    ['view', viewPanel],
  ])

  const setTab = (tab: string): void => {
    activeTab = tab
    for (const [id, button] of tabButtons) {
      const on = id === tab
      button.classList.toggle('is-active', on)
      button.setAttribute('aria-selected', on ? 'true' : 'false')
    }
    for (const [id, panel] of panels) {
      panel.hidden = id !== tab
    }
    colorSection.hidden =
      tab !== 'appearance' || current.theme !== 'custom' || colorSectionHiddenBySearch
  }

  const fill = (config: AppConfig): void => {
    current = config
    themeSelect.value = config.theme
    fontInput.value = String(config.fontSize || 16)
    widthInput.value = String(config.lineWidth || 780)
    bodyFontInput.value = config.bodyFont ?? ''
    codeFontInput.value = config.codeFont ?? ''
    autoSaveCheck.checked = config.autoSave === true
    autoSaveDelayInput.value = String(config.autoSaveDelayMs ?? 1500)
    autoSaveDelayInput.disabled = config.autoSave !== true
    typewriterCheck.checked = config.typewriter === true
    imagePasteCheck.checked = config.imagePaste !== false
    spellcheckCheck.checked = config.spellcheck === true
    restoreSessionCheck.checked = config.restoreSession !== false
    lineNumbersCheck.checked = config.lineNumbers === true
    showStatsCheck.checked = config.showStats !== false
    focusModeCheck.checked = config.focusMode === true
    colorSection.hidden =
      activeTab !== 'appearance' || config.theme !== 'custom' || colorSectionHiddenBySearch
    for (const field of COLOR_FIELDS) {
      const input = colorInputs.get(field.key)
      if (input) {
        input.value = toHexColor(config.customTheme?.[field.key], field.fallback)
      }
    }
  }

  const emit = (patch: Partial<AppConfig>): void => {
    const autoSaveOn = checked(autoSaveCheck)
    const next: AppConfig = {
      ...current,
      ...patch,
      theme: themeSelect.value as AppConfig['theme'],
      fontSize: Math.max(12, Math.min(28, Number(fontInput.value) || 16)),
      lineWidth: Math.max(480, Math.min(1400, Number(widthInput.value) || 780)),
      bodyFont: bodyFontInput.value.trim() || undefined,
      codeFont: codeFontInput.value.trim() || undefined,
      autoSave: autoSaveOn,
      autoSaveDelayMs: Math.max(300, Math.min(60000, Number(autoSaveDelayInput.value) || 1500)),
      typewriter: checked(typewriterCheck),
      imagePaste: checked(imagePasteCheck),
      spellcheck: checked(spellcheckCheck),
      restoreSession: checked(restoreSessionCheck),
      lineNumbers: checked(lineNumbersCheck),
      showStats: checked(showStatsCheck),
      focusMode: checked(focusModeCheck),
    }
    autoSaveDelayInput.disabled = !autoSaveOn
    if (next.theme === 'custom') {
      const customTheme: CustomTheme = { ...current.customTheme }
      for (const field of COLOR_FIELDS) {
        const input = colorInputs.get(field.key)
        if (input) customTheme[field.key] = input.value
      }
      next.customTheme = customTheme
    }
    current = next
    callbacks.onAppearanceChange(next)
    colorSection.hidden =
      activeTab !== 'appearance' || next.theme !== 'custom' || colorSectionHiddenBySearch
  }

  themeSelect.addEventListener('change', () => emit({}))
  fontInput.addEventListener('change', () => emit({}))
  widthInput.addEventListener('change', () => emit({}))
  bodyFontInput.addEventListener('change', () => emit({}))
  codeFontInput.addEventListener('change', () => emit({}))
  autoSaveDelayInput.addEventListener('change', () => emit({}))
  for (const input of [
    autoSaveCheck,
    typewriterCheck,
    imagePasteCheck,
    spellcheckCheck,
    restoreSessionCheck,
    lineNumbersCheck,
    showStatsCheck,
    focusModeCheck,
  ]) {
    input.addEventListener('change', () => emit({}))
  }
  for (const input of colorInputs.values()) {
    input.addEventListener('input', () => emit({}))
  }

  // ---- settings search -------------------------------------------------
  // Filters every tab generically: sections/fields are matched by their text,
  // tabs without hits collapse, and the active tab hops to the first hit.
  const searchInput = el('input', {
    class: 'settings__search',
    type: 'search',
    placeholder: '搜索设置…',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': '搜索设置',
  })
  const searchStatus = el('p', {
    class: 'settings__label settings__search-status',
    text: '没有匹配的设置项',
    hidden: true,
  })

  const includesQuery = (text: string, query: string): boolean =>
    text.toLowerCase().includes(query)

  let colorSectionMatched = false

  const applyFilter = (): void => {
    const query = searchInput.value.trim().toLowerCase()
    const searching = query.length > 0
    const matchesById = new Map<string, boolean>()
    colorSectionMatched = false

    for (const [id, panelBody] of panels) {
      let panelHit = !searching
      const sections = [...panelBody.querySelectorAll<HTMLElement>('.settings__section')]
      const units = sections.length > 0 ? sections : [panelBody]
      for (const section of units) {
        const isColorSection = section === colorSection
        const heading = section.querySelector('.settings__heading')?.textContent ?? ''
        const fields = [...section.querySelectorAll<HTMLElement>('.settings__field')]
        let sectionHit = !searching
        if (fields.length > 0) {
          const headingHit = searching && includesQuery(heading, query)
          let fieldHits = 0
          for (const field of fields) {
            if (field.hasAttribute('data-keep')) {
              field.hidden = false
              continue
            }
            const hit = headingHit || !searching || includesQuery(field.textContent ?? '', query)
            field.hidden = !hit
            if (hit) {
              fieldHits += 1
              sectionHit = true
            }
          }
          if (headingHit && fieldHits === 0) sectionHit = true
        } else {
          sectionHit = !searching || includesQuery(section.textContent ?? '', query)
        }
        section.hidden = !sectionHit
        if (sectionHit) {
          panelHit = true
          if (isColorSection) colorSectionMatched = true
        }
      }
      matchesById.set(id, panelHit)
      const button = tabButtons.get(id)
      if (button) button.hidden = searching && !panelHit
    }

    let firstMatch: string | null = null
    for (const [id, hit] of matchesById) {
      if (hit) {
        firstMatch = id
        break
      }
    }
    colorSectionHiddenBySearch = searching && !colorSectionMatched
    searchStatus.hidden = !searching || firstMatch !== null
    if (searching && matchesById.get(activeTab) === false && firstMatch) setTab(firstMatch)
    else setTab(activeTab)
  }

  searchInput.addEventListener('input', applyFilter)

  const body = el('div', { class: 'settings__body' }, appearancePanel, editorPanel, viewPanel)
  const panel = el(
    'div',
    { class: 'settings__panel', role: 'dialog', 'aria-label': '设置' },
    el(
      'header',
      { class: 'settings__header' },
      el('h2', { class: 'settings__title', text: '设置' }),
      searchInput,
      el('button', {
        class: 'settings__close',
        type: 'button',
        text: '×',
        'aria-label': '关闭',
        onclick: () => close(),
      }),
    ),
    searchStatus,
    tabNav,
    body,
  )
  const root = el('div', { class: 'settings', hidden: true }, panel)

  const registerTab = (spec: SettingsTabSpec): (() => void) => {
    if (tabButtons.has(spec.id)) throw new Error(`settings tab already registered: ${spec.id}`)
    const button = el('button', {
      class: 'settings__tab',
      type: 'button',
      role: 'tab',
      'data-tab': spec.id,
      'aria-selected': 'false',
      text: spec.label,
      onclick: () => setTab(spec.id),
    })
    const newPanel = spec.render()
    newPanel.hidden = true
    tabNav.appendChild(button)
    body.appendChild(newPanel)
    tabButtons.set(spec.id, button)
    panels.set(spec.id, newPanel)
    return () => {
      button.remove()
      newPanel.remove()
      tabButtons.delete(spec.id)
      panels.delete(spec.id)
      if (activeTab === spec.id) setTab('appearance')
    }
  }

  const open = (tab?: string): void => {
    fill(callbacks.getAppearance())
    applyFilter()
    if (tab) setTab(tab)
    else setTab(activeTab)
    root.hidden = false
    themeSelect.focus()
  }

  const close = (): void => {
    root.hidden = true
    callbacks.onClose?.()
    // A stale query would hide fields on the next open — reset it here.
    if (searchInput.value !== '') {
      searchInput.value = ''
      applyFilter()
    }
  }

  const toggle = (): void => {
    if (root.hidden) open()
    else close()
  }

  root.addEventListener('click', (event) => {
    if (event.target === root) close()
  })

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
  })

  fill(current)
  setTab(activeTab)

  return {
    el: root,
    open,
    close,
    toggle,
    isOpen: () => !root.hidden,
    getTab: () => activeTab,
    setTab,
    registerTab,
  }
}
