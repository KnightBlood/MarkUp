/**
 * GitHub-style alert blocks — the `> [!NOTE]` / `> [!TIP]` / `> [!IMPORTANT]` /
 * `> [!WARNING]` / `> [!CAUTION]` construct Typora renders as a titled callout.
 *
 * Pure mdast transform, no micromark extension: the blockquote parses normally
 * and the `[!NOTE]` marker is just leading paragraph text, so removing it and
 * restyling the block is enough. That keeps the syntax working in all three
 * views and in export with a single implementation.
 *
 * Output shape:
 *
 * ```html
 * <div class="md-alert md-alert--note">
 *   <p class="md-alert__title">Note</p>
 *   …blockquote content…
 * </div>
 * ```
 */

export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

/** Typora / GitHub label for each kind — used as the rendered title. */
export const ALERT_LABELS: Record<AlertKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

const KINDS = Object.keys(ALERT_LABELS) as AlertKind[]

/** `[!NOTE]` in any case, optionally followed by the rest of the line. */
const MARKER = new RegExp(`^\\s*\\[!(${KINDS.join('|')})\\]\\s*`, 'i')

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: { hName?: string; hProperties?: Record<string, unknown> }
}

/** Text of a node's first inline child, used to spot the marker. */
function firstText(node: MdNode | undefined): MdNode | undefined {
  if (!node) return undefined
  if (node.type === 'text') return node
  if (!node.children) return undefined
  for (const child of node.children) {
    const found = firstText(child)
    if (found) return found
  }
  return undefined
}

function titleNode(kind: AlertKind): MdNode {
  return {
    type: 'paragraph',
    data: { hName: 'p', hProperties: { className: ['md-alert__title'] } },
    children: [{ type: 'text', value: ALERT_LABELS[kind] }],
  }
}

function convert(quote: MdNode): void {
  const first = quote.children?.[0]
  if (!first || first.type !== 'paragraph') return
  const text = firstText(first)
  if (!text || typeof text.value !== 'string') return
  const match = MARKER.exec(text.value)
  if (!match) return

  const kind = (match[1] ?? 'note').toLowerCase() as AlertKind
  const rest = text.value.slice(match[0].length)
  // Keep a single leading break so `> [!NOTE]\n> body` reads as two lines
  // rather than gluing "NOTEbody" together if the marker shared its line.
  text.value = rest.replace(/^\r?\n/, '')

  // The marker was the paragraph's only content — drop the now-empty wrapper.
  if (
    first.children?.length === 1 &&
    typeof text.value === 'string' &&
    text.value.length === 0
  ) {
    quote.children = quote.children?.slice(1) ?? []
  } else if (typeof text.value === 'string' && text.value.length === 0) {
    first.children = first.children?.filter((child) => child !== text) ?? []
  }

  quote.children = [titleNode(kind), ...(quote.children ?? [])]
  quote.data = {
    ...quote.data,
    hName: 'div',
    hProperties: { className: ['md-alert', `md-alert--${kind}`] },
  }
}

/**
 * Remark transform converting every qualifying blockquote. Runs after
 * `remark-gfm` so `blockquote` nodes already exist.
 *
 * Returns the transformer directly (not an attacher) — see the note on
 * {@link mdSyntax} for why that distinction matters.
 */
export function mdAlerts() {
  return function transformer(tree: MdNode): void {
    const visit = (node: MdNode): void => {
      if (node.type === 'blockquote') convert(node)
      for (const child of node.children ?? []) visit(child)
    }
    visit(tree)
  }
}
