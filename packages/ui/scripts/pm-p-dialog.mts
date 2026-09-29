import { JSDOM } from 'jsdom'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
})
const g = globalThis as typeof globalThis & {
  window: Window & typeof globalThis
  document: Document
  HTMLElement: typeof HTMLElement
  Element: typeof Element
  Node: typeof Node
}
g.window = dom.window as unknown as Window & typeof globalThis
g.document = dom.window.document
g.HTMLElement = dom.window.HTMLElement as typeof g.HTMLElement
g.Element = dom.window.Element as typeof g.Element
g.Node = dom.window.Node as typeof g.Node

const { showHostMessage } = await import('../src/ui/messageDialog')

// ── defaults: title Markup, single 确定 button, message rendered ─────────
{
  const pending = showHostMessage({ message: '测试消息' })
  const dialog = document.querySelector('dialog.msg-dialog') as HTMLDialogElement | null
  assert(dialog, 'dialog element rendered')
  assert(dialog.hasAttribute('open'), 'dialog is modal (open attribute)')
  assert(
    dialog.getAttribute('aria-label') === 'Markup',
    `aria-label from default title: ${dialog.getAttribute('aria-label')}`,
  )
  assert(
    dialog.querySelector('.msg-dialog__title')?.textContent === 'Markup',
    'default title text',
  )
  assert(
    dialog.querySelector('.msg-dialog__body')?.textContent === '测试消息',
    'message body rendered',
  )
  const buttons = [...dialog.querySelectorAll('.msg-dialog__btn')]
  assert(buttons.length === 1, `default single button, got ${buttons.length}`)
  assert(buttons[0]?.textContent === '确定', 'default button label 确定')
  assert(
    buttons[0]?.classList.contains('msg-dialog__btn--primary'),
    'first button styled primary',
  )

  ;(buttons[0] as HTMLButtonElement).click()
  const result = await pending
  assert(result.button === '确定', `confirm resolves button label: ${result.button}`)
  assert(!document.querySelector('dialog.msg-dialog'), 'dialog removed after confirm')
}

// ── custom title/buttons: clicking 否 resolves its label ─────────────────
{
  const pending = showHostMessage({ title: '覆盖文件？', message: '目标已存在', buttons: ['是', '否'] })
  const dialog = document.querySelector('dialog.msg-dialog') as HTMLDialogElement | null
  assert(dialog, 'second dialog rendered')
  assert(
    dialog.querySelector('.msg-dialog__title')?.textContent === '覆盖文件？',
    'custom title',
  )
  const labels = [...dialog.querySelectorAll('.msg-dialog__btn')].map((b) => b.textContent)
  assert(JSON.stringify(labels) === '["是","否"]', `button order: ${JSON.stringify(labels)}`)

  const no = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '否')
  assert(no, '否 button found')
  ;(no as HTMLButtonElement).click()
  const result = await pending
  assert(result.button === '否', `否 resolves its label: ${result.button}`)
  assert(!document.querySelector('dialog.msg-dialog'), 'dialog removed after 否')
}

// ── dismissal (Escape path: native cancel → close event) ─────────────────
{
  const pending = showHostMessage({ message: '可关闭的提示' })
  const dialog = document.querySelector('dialog.msg-dialog') as HTMLDialogElement | null
  assert(dialog, 'third dialog rendered')
  // Escape on a native <dialog> fires `close`; jsdom has no built-in key
  // handling, so dispatch the exact event a browser would.
  dialog.dispatchEvent(new dom.window.Event('close'))
  const result = await pending
  assert(result.button === '', `dismiss resolves empty label: ${JSON.stringify(result.button)}`)
  assert(!document.querySelector('dialog.msg-dialog'), 'dialog removed on dismiss')
}

console.log(
  'SMOKE UI DIALOG OK: defaults (title/buttons/body) + custom buttons resolve labels + close-path dismissal removes dialog',
)
