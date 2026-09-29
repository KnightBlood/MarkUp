import { el } from '../dom'
import { formatShortcut, shortcutFromEvent, type CommandRegistry } from '../commands'

export interface KeybindingsOptions {
  registry: CommandRegistry
  /** Called after every rebind/reset so the caller can persist the map. */
  onChange: (overrides: Record<string, string>) => void
}

export interface KeybindingsPanel {
  el: HTMLElement
  /** Rebuild rows (after config load or external rebind). */
  refresh: () => void
  /** Abort a pending key capture (panel/dialog closed). */
  dispose: () => void
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'])

/**
 * Settings → 快捷键: full command table with key capture, conflict detection,
 * per-row restore and a global "restore all defaults".
 */
export function createKeybindingsPanel(options: KeybindingsOptions): KeybindingsPanel {
  const { registry } = options

  const status = el('p', { class: 'settings__label keys__status' })
  const filterInput = el('input', {
    class: 'settings__input keys__filter',
    type: 'search',
    placeholder: '筛选命令 / 按键…',
    spellcheck: 'false',
    autocomplete: 'off',
    'data-keep': '1',
  })
  const list = el('div', { class: 'keys-list' })

  let recordingId: string | null = null
  let captureHandler: ((event: KeyboardEvent) => void) | null = null

  const setStatus = (message: string, bad = false): void => {
    status.textContent = message
    status.classList.toggle('settings__issue', bad)
    status.classList.toggle('settings__issue--warn', bad)
  }

  const stopRecording = (): void => {
    if (captureHandler) window.removeEventListener('keydown', captureHandler, true)
    captureHandler = null
    if (recordingId !== null) recordingId = null
    registry.setSuspended(false)
  }

  const startRecording = (id: string): void => {
    stopRecording()
    recordingId = id
    registry.setSuspended(true)
    setStatus('按下新的组合键（Ctrl / ⌘ + 按键），Esc 取消')
    captureHandler = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        stopRecording()
        setStatus('已取消改绑')
        refresh()
        return
      }
      if (MODIFIER_KEYS.has(event.key)) return
      const shortcut = shortcutFromEvent(event)
      if (!shortcut) {
        setStatus('需要 Ctrl / ⌘ 组合键（纯字母会被输入到文档）', true)
        return
      }
      const conflict = registry.findByShortcut(shortcut, id)
      if (conflict) {
        setStatus(
          `冲突：${formatShortcut(shortcut)} 已绑定「${conflict.label}」，请先改绑或清除该项`,
          true,
        )
        return
      }
      registry.setShortcut(id, shortcut)
      options.onChange(registry.getOverrides())
      stopRecording()
      setStatus(`已绑定 ${formatShortcut(shortcut)}`)
      refresh()
    }
    window.addEventListener('keydown', captureHandler, true)
    refresh()
  }

  const buildRow = (id: string, label: string): HTMLElement => {
    const effective = registry.shortcutFor(id)
    const customized = registry.isCustomized(id)
    const keys = el('kbd', {
      class: `keys-row__keys${effective ? '' : ' keys-row__keys--empty'}${customized ? ' is-custom' : ''}`,
      text: effective ? formatShortcut(effective) : '未绑定',
    })
    const rebind = el('button', {
      class: 'keys-row__btn',
      type: 'button',
      text: recordingId === id ? '按下组合键…' : '改绑',
      onclick: () => (recordingId === id ? stopRecordingAndRefresh() : startRecording(id)),
    })
    const restore = el('button', {
      class: 'keys-row__btn keys-row__btn--ghost',
      type: 'button',
      text: '默认',
      disabled: !customized,
      title: registry.defaultShortcut(id)
        ? `恢复默认 ${formatShortcut(registry.defaultShortcut(id))}`
        : '该命令默认未绑定',
      onclick: () => {
        registry.setShortcut(id, null)
        options.onChange(registry.getOverrides())
        setStatus(`已恢复「${label}」默认键位`)
        refresh()
      },
    })
    const row = el(
      'div',
      {
        class: `settings__field settings__field--row keys-row${recordingId === id ? ' is-recording' : ''}`,
        'data-id': id,
      },
      el(
        'span',
        { class: 'settings__label keys-row__label' },
        el('span', { class: 'keys-row__name', text: label }),
        el('span', { class: 'keys-row__id', text: id }),
      ),
      keys,
      el('span', { class: 'keys-row__actions' }, rebind, restore),
    )
    return row
  }

  const stopRecordingAndRefresh = (): void => {
    stopRecording()
    setStatus('已取消改绑')
    refresh()
  }

  const applyFilter = (): void => {
    const query = filterInput.value.trim().toLowerCase()
    const rows = list.querySelectorAll<HTMLElement>('.keys-row')
    let visible = 0
    for (const row of rows) {
      const hit = query.length === 0 || (row.textContent ?? '').toLowerCase().includes(query)
      row.hidden = !hit
      if (hit) visible += 1
    }
    empty.hidden = visible > 0
  }

  const empty = el('p', {
    class: 'settings__label keys-empty',
    text: '没有匹配的命令',
    hidden: true,
  })

  const resetAll = el('button', {
    class: 'keys-row__btn keys-row__btn--ghost',
    type: 'button',
    text: '全部恢复默认',
    onclick: () => {
      stopRecording()
      for (const command of registry.list()) registry.setShortcut(command.id, null)
      options.onChange(registry.getOverrides())
      setStatus('已恢复全部默认键位')
      refresh()
    },
  })

  filterInput.addEventListener('input', applyFilter)

  const refresh = (): void => {
    const commands = registry.list()
    list.replaceChildren(...commands.map((command) => buildRow(command.id, command.label)))
    applyFilter()
  }

  const panel = el(
    'div',
    { class: 'settings__panel-body', 'data-tab-panel': 'keys' },
    el(
      'section',
      { class: 'settings__section' },
      el('h3', { class: 'settings__heading', text: '快捷键' }),
      el('p', {
        class: 'settings__label',
        text: '点击「改绑」后按下新的组合键；冲突时需先改绑占用项。改绑作用于应用内按键，原生菜单与系统级快捷键仍保持默认键位。',
      }),
      el('div', { class: 'settings__field settings__field--row keys__toolbar', 'data-keep': '1' }, filterInput, resetAll),
      status,
      list,
      empty,
    ),
  )

  refresh()
  setStatus('')

  return {
    el: panel,
    refresh,
    dispose: stopRecording,
  }
}
