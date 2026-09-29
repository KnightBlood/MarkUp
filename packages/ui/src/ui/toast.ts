export interface ToastOptions {
  level?: 'info' | 'warn' | 'error'
  /** Auto-dismiss in ms; 0 keeps it until clicked. Defaults: error 6000, others 3500. */
  timeout?: number
}

export interface ToastHost {
  el: HTMLElement
  show: (message: string, options?: ToastOptions) => void
}

const MAX_VISIBLE = 5

export function createToastHost(): ToastHost {
  const el = document.createElement('div')
  el.className = 'toast-host'

  const show = (message: string, options?: ToastOptions): void => {
    const level = options?.level ?? 'info'
    const timeout = options?.timeout ?? (level === 'error' ? 6000 : 3500)
    const item = document.createElement('div')
    item.className = `toast toast--${level}`
    item.setAttribute('role', level === 'error' ? 'alert' : 'status')

    const text = document.createElement('span')
    text.className = 'toast__text'
    text.textContent = message

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'toast__close'
    close.textContent = '×'
    close.setAttribute('aria-label', '关闭')

    const dismiss = (): void => {
      item.remove()
    }
    close.addEventListener('click', dismiss)
    item.append(text, close)
    el.appendChild(item)

    while (el.childElementCount > MAX_VISIBLE) {
      el.firstElementChild?.remove()
    }
    if (timeout > 0) window.setTimeout(dismiss, timeout)
  }

  return { el, show }
}
