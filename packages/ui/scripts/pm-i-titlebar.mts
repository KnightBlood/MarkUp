function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { titlebarMenuItems } = await import('../src/ui/titlebar')

const calls: string[] = []
const hostWithWindow = {
  platform: 'electron',
  window: {
    minimize: () => calls.push('minimize'),
    toggleMaximize: () => calls.push('toggleMaximize'),
    close: () => calls.push('close'),
  },
} as never as import('@markup/host-api').HostAPI

const items = titlebarMenuItems(hostWithWindow, () => calls.push('reload'))
assert(items.length === 6, `6 items (3 controls + seps + reload), got ${items.length}`)
const labels = items.filter((i) => i.label).map((i) => i.label)
assert(labels.join(',') === '最小化,最大化 / 还原,关闭,重新加载', `labels: ${labels.join(',')}`)

for (const item of items) item.run?.()
assert(calls.join(',') === 'minimize,toggleMaximize,close,reload', `runs: ${calls.join(',')}`)

const hostNoWindow = { platform: 'web' } as never as import('@markup/host-api').HostAPI
const webItems = titlebarMenuItems(hostNoWindow)
assert(webItems.length === 0, `no window → empty, got ${webItems.length}`)

const webWithReload = titlebarMenuItems(hostNoWindow, () => calls.push('web-reload'))
assert(webWithReload.length === 1, 'reload only on web')
webWithReload[0]?.run?.()
assert(calls.at(-1) === 'web-reload', 'reload ran')

console.log('SMOKE UI TITLEBAR OK: menu items + empty on no-window host')
