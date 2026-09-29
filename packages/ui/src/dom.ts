type Child = Node | string | null | undefined

type ElAttrs = Record<string, unknown>

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue
    if (key === 'class') {
      node.className = String(value)
      continue
    }
    if (key === 'text') {
      node.textContent = String(value)
      continue
    }
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      continue
    }
    if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '')
      continue
    }
    node.setAttribute(key, String(value))
  }
  for (const child of children) {
    if (child == null) continue
    node.append(child)
  }
  return node
}