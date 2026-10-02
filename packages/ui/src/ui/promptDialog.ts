import { el } from '../dom'

export interface PromptOptions {
  title: string
  /** Small explanatory line above the field. */
  message?: string
  value?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
}

/**
 * Modal single-line input built on the same `<dialog>` shell as
 * {@link showHostMessage}, so it looks identical in every host.
 *
 * Resolves with the entered text, or `null` when cancelled (Escape /
 * Cancel / close). Empty input resolves to `''` — the caller decides whether
 * that means "abort".
 */
export function showPrompt(options: PromptOptions): Promise<string | null> {
  const confirmLabel = options.confirmText ?? '确定'
  const cancelLabel = options.cancelText ?? '取消'

  return new Promise<string | null>((resolve) => {
    let settled = false
    const settle = (value: string | null): void => {
      if (settled) return
      settled = true
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      dialog.remove()
      resolve(value)
    }

    const input = el('input', {
      class: 'msg-dialog__input',
      type: 'text',
      value: options.value ?? '',
      placeholder: options.placeholder ?? '',
      spellcheck: 'false',
      autocomplete: 'off',
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          settle(input.value)
        }
      },
    }) as HTMLInputElement

    const foot = el(
      'div',
      { class: 'msg-dialog__foot' },
      el('button', {
        type: 'button',
        class: 'msg-dialog__btn',
        text: cancelLabel,
        onclick: () => settle(null),
      }),
      el('button', {
        type: 'button',
        class: 'msg-dialog__btn msg-dialog__btn--primary',
        text: confirmLabel,
        onclick: () => settle(input.value),
      }),
    )

    const head = el(
      'div',
      { class: 'msg-dialog__head' },
      el('h2', { class: 'msg-dialog__title', text: options.title }),
      el('button', {
        type: 'button',
        class: 'msg-dialog__close',
        'aria-label': '关闭',
        text: '×',
        onclick: () => settle(null),
      }),
    )

    const dialog = el(
      'dialog',
      { class: 'msg-dialog msg-dialog--prompt', 'aria-label': options.title },
      head,
      options.message
        ? el('div', { class: 'msg-dialog__body', text: options.message })
        : null,
      el('div', { class: 'msg-dialog__field' }, input),
      foot,
    )

    dialog.addEventListener('close', () => settle(null))
    document.body.append(dialog)
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')

    input.focus()
    // Select the pre-filled text so typing replaces it (re-editing a link).
    if (options.value) input.select()
  })
}
