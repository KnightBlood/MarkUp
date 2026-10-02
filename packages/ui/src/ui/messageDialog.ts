import type { MessageOptions, MessageResult } from '@markup/host-api'
import { el } from '../dom'

/**
 * In-app replacement for the native HostAPI message box.
 *
 * Renders a modal `<dialog>` styled with the shell tokens, so every host
 * (web / Electron / Tauri / Wails) shows the same popup — previously
 * Electron/Tauri/Wails used OS-native boxes and the web host resolved
 * silently without ever showing anything.
 *
 * Resolves with the clicked button label, or `''` when dismissed (Escape).
 */
export function showHostMessage(options: MessageOptions): Promise<MessageResult> {
  const title = options.title ?? 'Markup'
  const labels =
    options.buttons && options.buttons.length > 0 ? options.buttons : ['确定']

  return new Promise<MessageResult>((resolve) => {
    let settled = false
    const settle = (button: string): void => {
      if (settled) return
      settled = true
      // Closing fires the native `close` event (Escape path) — the settled
      // flag makes that re-entry a no-op.
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      dialog.remove()
      resolve({ button })
    }

    const head = el(
      'div',
      { class: 'msg-dialog__head' },
      el('h2', { class: 'msg-dialog__title', text: title }),
      el('button', {
        type: 'button',
        class: 'msg-dialog__close',
        'aria-label': '关闭',
        text: '×',
        onclick: () => settle(''),
      }),
    )

    const foot = el(
      'div',
      { class: 'msg-dialog__foot' },
      ...labels.map((label, index) =>
        el('button', {
          type: 'button',
          class:
            index === 0
              ? 'msg-dialog__btn msg-dialog__btn--primary'
              : 'msg-dialog__btn',
          text: label,
          onclick: () => settle(label),
        }),
      ),
    )

    const dialog = el(
      'dialog',
      { class: 'msg-dialog', 'aria-label': title },
      head,
      el('div', { class: 'msg-dialog__body', text: options.message }),
      foot,
    )

    // Escape cancels the native dialog → `close` without a chosen button.
    dialog.addEventListener('close', () => settle(''))
    document.body.append(dialog)
    // Environments without HTMLDialogElement methods (jsdom) fall back to
    // the `open` attribute; browsers take the real modal path.
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    const first = foot.querySelector('button')
    if (first) first.focus()
  })
}
