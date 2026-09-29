/**
 * Flowchart codec: mermaid flowchart/graph source <-> editable graph model.
 *
 * Storage contract (round-trip):
 * - Source of truth is the mermaid fence (GitHub renders it anywhere).
 * - GUI-only metadata (node positions/sizes) rides in a `%%x6:{...}` comment,
 *   which mermaid treats as a no-op comment (verified with mermaid.parse).
 * - Lines we don't model (style/classDef/linkStyle/click/comments/init
 *   directives) are preserved verbatim so editing never drops content.
 * - Diagrams outside the supported subset (sequence, subgraph, exotic edges)
 *   parse as `{ ok: false }` and the editor falls back to source mode.
 */

export type FlowDir = 'TD' | 'TB' | 'LR' | 'RL' | 'BT'

export type FlowNodeShape =
  | 'stadium'
  | 'rect'
  | 'rounded'
  | 'diamond'
  | 'circle'
  | 'hexagon'
  | 'parallelogram'
  | 'parallelogramAlt'

export type FlowEdgeStyle = 'solid' | 'dashed' | 'thick'
export type FlowEdgeArrows = 'forward' | 'both' | 'none'

export interface FlowNode {
  id: string
  shape: FlowNodeShape
  label: string
  /** Declared with an explicit wrapper (vs a bare id created by an edge). */
  explicit: boolean
  /** Optional `:::class` suffix (with matching classDef preserved in extras). */
  cls?: string
  x?: number
  y?: number
  w?: number
  h?: number
}

export interface FlowEdge {
  from: string
  to: string
  style: FlowEdgeStyle
  arrows: FlowEdgeArrows
  label?: string
}

export interface FlowGraph {
  dir: FlowDir
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** Verbatim preserved lines: comments, style/classDef/linkStyle/click... */
  extras: string[]
}

export type FlowParseResult =
  | { ok: true; graph: FlowGraph }
  | { ok: false; reason: 'not-flowchart' | 'unsupported' }

const META_PREFIX = '%%x6:'

const RESERVED_IDS = new Set([
  'end',
  'graph',
  'subgraph',
  'style',
  'class',
  'classdef',
  'linkstyle',
  'click',
  'direction',
  'acctitle',
  'accdescr',
  'o',
  'x',
])

/** Keyword-leading lines are reserved by mermaid / subgraph syntax. */
const KEYWORD_LINE = /^(?:end|subgraph|direction)\b/

/** Styling/meta lines preserved verbatim (require whitespace after keyword). */
const EXTRAS_LINE = /^(?:style|classDef|class|linkStyle|click|accTitle|accDescr|title)\s/

const HEADER_RE = /^(?:flowchart|graph)\s*([A-Za-z]{0,2})?\s*$/

const DIRS = new Set<string>(['TD', 'TB', 'LR', 'RL', 'BT', 'td', 'tb', 'lr', 'rl', 'bt'])

/**
 * Node id: any run of non-structural chars. `-` and arrow chars are excluded so
 * tight arrows (`A-->B`) scan as id + op + id; hyphenated ids (`node-1`) fall
 * back to source mode. CJK and other unicode ids are allowed (mermaid accepts
 * them, verified in smoke).
 */
const ID_RE = /^[^\s\[\](){}<>|=;:.,'"`\\-]+/

/**
 * Order matters: longest/ambiguous wrappers first. Each wrapper tries a
 * quoted label first so labels may safely contain brackets/parens
 * (`B["含 (括号) 和 [方]"]`), falling back to a lazy plain capture.
 * Group 1 = quoted inner, group 2 = plain inner.
 */
const SHAPE_RES: Array<[RegExp, FlowNodeShape]> = [
  [/\(\[(?:"((?:[^"\\]|\\.)*)"|(.*?))\]\)/y, 'stadium'],
  [/\(\((?:"((?:[^"\\]|\\.)*)"|(.*?))\)\)/y, 'circle'],
  [/\((?:"((?:[^"\\]|\\.)*)"|(.*?))\)/y, 'rounded'],
  [/\{\{(?:"((?:[^"\\]|\\.)*)"|(.*?))\}\}/y, 'hexagon'],
  [/\{(?:"((?:[^"\\]|\\.)*)"|(.*?))\}/y, 'diamond'],
  [/\[\/(?:"((?:[^"\\]|\\.)*)"|(.*?))\/\]/y, 'parallelogram'],
  [/\[\\(?:"((?:[^"\\]|\\.)*)"|(.*?))\\\]/y, 'parallelogramAlt'],
  [/\[(?:"((?:[^"\\]|\\.)*)"|(.*?))\]/y, 'rect'],
]

const PLAIN_OPS: Array<{ re: RegExp; style: FlowEdgeStyle; arrows: FlowEdgeArrows }> = [
  { re: /<==>/y, style: 'thick', arrows: 'both' },
  { re: /<-\.\->/y, style: 'dashed', arrows: 'both' },
  { re: /<-->/y, style: 'solid', arrows: 'both' },
  { re: /==>/y, style: 'thick', arrows: 'forward' },
  { re: /===/y, style: 'thick', arrows: 'none' },
  { re: /-\.\->/y, style: 'dashed', arrows: 'forward' },
  { re: /-\.-/y, style: 'dashed', arrows: 'none' },
  { re: /-->/y, style: 'solid', arrows: 'forward' },
  { re: /---/y, style: 'solid', arrows: 'none' },
]

/**
 * `A -- text --> B`, `A -. text .-> B`, `A == text ==> B`.
 * The solid form requires whitespace after `--` so tight markers like
 * `--x-->` / `--o-->` fall through to unsupported instead of a fake label.
 */
const TEXT_OPS: Array<{ re: RegExp; style: FlowEdgeStyle; arrows: FlowEdgeArrows }> = [
  { re: /--\s+([^|>][^>]*?)\s*-->/y, style: 'solid', arrows: 'forward' },
  { re: /-\.\s*([^|][^>]*?)\s*\.->/y, style: 'dashed', arrows: 'forward' },
  { re: /==\s*([^|=][^>]*?)\s*==>/y, style: 'thick', arrows: 'forward' },
]

const QUOTE_TRIGGER = /[\[\](){}|/\\#"']/

interface NodeTok {
  id: string
  shape?: FlowNodeShape
  label?: string
  cls?: string
  end: number
}

function stripQuotes(text: string): string {
  const t = text.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\"/g, '"')
  }
  return t
}

function normLabel(raw: string): string {
  const text = stripQuotes(raw).replace(/[\r\n]+/g, ' ').trim()
  return text
}

function labelOrId(label: string, id: string): string {
  return label || id
}

function matchNode(src: string, pos: number): NodeTok | null {
  const idm = ID_RE.exec(src.slice(pos))
  if (!idm) return null
  let i = pos + idm[0].length
  let shape: FlowNodeShape | undefined
  let label: string | undefined
  for (const [re, sh] of SHAPE_RES) {
    re.lastIndex = i
    const m = re.exec(src)
    if (m) {
      shape = sh
      label = normLabel(m[1] ?? m[2] ?? '')
      i = re.lastIndex
      break
    }
  }
  let cls: string | undefined
  const clm = /^:::(\S+)/.exec(src.slice(i))
  if (clm) {
    cls = clm[1]
    i += clm[0].length
  }
  return { id: idm[0], shape, label, cls, end: i }
}

interface EdgeOpTok {
  style: FlowEdgeStyle
  arrows: FlowEdgeArrows
  label?: string
  end: number
}

function matchEdgeOp(src: string, pos: number): EdgeOpTok | null {
  for (const op of PLAIN_OPS) {
    op.re.lastIndex = pos
    const m = op.re.exec(src)
    if (m) return { style: op.style, arrows: op.arrows, end: op.re.lastIndex }
  }
  for (const op of TEXT_OPS) {
    op.re.lastIndex = pos
    const m = op.re.exec(src)
    if (m) {
      return {
        style: op.style,
        arrows: op.arrows,
        label: normLabel(m[1] ?? '') || undefined,
        end: op.re.lastIndex,
      }
    }
  }
  return null
}

function addNode(tok: NodeTok, nodes: Map<string, FlowNode>): void {
  const existing = nodes.get(tok.id)
  if (tok.shape !== undefined) {
    if (!existing) {
      nodes.set(tok.id, {
        id: tok.id,
        shape: tok.shape,
        label: labelOrId(tok.label ?? '', tok.id),
        explicit: true,
        cls: tok.cls,
      })
    } else if (!existing.explicit) {
      existing.explicit = true
      existing.shape = tok.shape
      existing.label = labelOrId(tok.label ?? '', tok.id)
      if (tok.cls) existing.cls = tok.cls
    } else if (tok.cls && !existing.cls) {
      existing.cls = tok.cls
    }
    return
  }
  if (!existing) {
    nodes.set(tok.id, { id: tok.id, shape: 'rect', label: tok.id, explicit: false, cls: tok.cls })
  } else if (tok.cls && !existing.cls) {
    existing.cls = tok.cls
  }
}

/** Splits `A-->B; C-->D` into statements, ignoring `;` inside pipes/wrappers. */
function splitStatements(line: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let inPipe = false
  for (const ch of line) {
    if (ch === '|' && depth === 0) inPipe = !inPipe
    if (!inPipe) {
      if (ch === '[' || ch === '(' || ch === '{') depth += 1
      else if (ch === ']' || ch === ')' || ch === '}') depth = Math.max(0, depth - 1)
      else if (ch === ';' && depth === 0) {
        parts.push(current)
        current = ''
        continue
      }
    }
    current += ch
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Returns false when the line belongs to the supported subset but we can't parse it. */
function parseStatement(
  rawLine: string,
  nodes: Map<string, FlowNode>,
  edges: FlowEdge[],
): boolean {
  const statements = splitStatements(rawLine)
  if (statements.length === 0) return true
  for (const line of statements) {
    if (!parseSingleStatement(line, nodes, edges)) return false
  }
  return true
}

function parseSingleStatement(
  line: string,
  nodes: Map<string, FlowNode>,
  edges: FlowEdge[],
): boolean {
  let i = 0
  const skipWs = (): void => {
    while (i < line.length && /\s/.test(line[i] ?? '')) i += 1
  }
  skipWs()
  const first = matchNode(line, i)
  if (!first) return false
  addNode(first, nodes)
  i = first.end
  let base = first.id
  for (;;) {
    skipWs()
    if (i >= line.length) return true
    const op = matchEdgeOp(line, i)
    if (!op) return false
    i = op.end
    let label = op.label
    if (label === undefined) {
      const lm = /^\s*\|([^|]*)\|/.exec(line.slice(i))
      if (lm) {
        i += lm[0].length
        label = normLabel(lm[1] ?? '') || undefined
      }
    }
    skipWs()
    const next = matchNode(line, i)
    if (!next) return false
    addNode(next, nodes)
    i = next.end
    edges.push({
      from: base,
      to: next.id,
      style: op.style,
      arrows: op.arrows,
      label,
    })
    base = next.id
  }
}

interface MetaPos {
  [id: string]: number[]
}

function applyMeta(meta: MetaPos | null, nodes: Map<string, FlowNode>): void {
  if (!meta) return
  for (const [id, box] of Object.entries(meta)) {
    const node = nodes.get(id)
    if (!node || !Array.isArray(box)) continue
    const [x, y, w, h] = box
    if (Number.isFinite(x) && Number.isFinite(y)) {
      node.x = x
      node.y = y
      if (Number.isFinite(w)) node.w = w
      if (Number.isFinite(h)) node.h = h
    }
  }
}

export function parseFlowchart(code: string): FlowParseResult {
  const lines = code.replace(/\uFEFF/g, '').replace(/\r\n/g, '\n').split('\n')
  const nodes = new Map<string, FlowNode>()
  const edges: FlowEdge[] = []
  const extras: string[] = []
  let dir: FlowDir | null = null
  let meta: MetaPos | null = null
  let headerSeen = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (!headerSeen) {
      if (line.startsWith(META_PREFIX)) {
        meta = parseMeta(line)
        continue
      }
      if (line.startsWith('%%')) {
        extras.push(line)
        continue
      }
      const hm = HEADER_RE.exec(line)
      if (!hm) {
        if (/^(?:flowchart|graph)\b/.test(line)) return { ok: false, reason: 'unsupported' }
        return { ok: false, reason: 'not-flowchart' }
      }
      const dirToken = (hm[1] || 'TB').toUpperCase()
      if (!DIRS.has(dirToken)) return { ok: false, reason: 'unsupported' }
      dir = dirToken as FlowDir
      headerSeen = true
      continue
    }

    if (line.startsWith(META_PREFIX)) {
      meta = parseMeta(line)
      continue
    }
    if (line.startsWith('%%')) {
      extras.push(line)
      continue
    }
    if (KEYWORD_LINE.test(line)) return { ok: false, reason: 'unsupported' }
    if (EXTRAS_LINE.test(line)) {
      extras.push(line)
      continue
    }
    if (HEADER_RE.test(line)) return { ok: false, reason: 'unsupported' }
    if (!parseStatement(line, nodes, edges)) return { ok: false, reason: 'unsupported' }
  }

  if (!dir) return { ok: false, reason: 'not-flowchart' }
  applyMeta(meta, nodes)
  return { ok: true, graph: { dir, nodes: [...nodes.values()], edges, extras } }
}

function parseMeta(line: string): MetaPos | null {
  try {
    const parsed = JSON.parse(line.slice(META_PREFIX.length)) as { v?: number; n?: MetaPos }
    if (parsed && typeof parsed === 'object' && parsed.n && typeof parsed.n === 'object') {
      return parsed.n
    }
  } catch {
    /* malformed metadata is ignored; positions fall back to auto-layout */
  }
  return null
}

/** Label needs quotes when it contains wrapper/shorthand characters. */
function emitLabel(label: string): string {
  const text = label.trim()
  if (!text) return ''
  if (QUOTE_TRIGGER.test(text) || text !== label) return JSON.stringify(label)
  return text
}

/**
 * Edge labels live inside `|...|`: mermaid rejects raw `"`, `[]`, `{}`, `()`
 * there, but accepts a fully double-quoted form (without inner quotes).
 * Verified against mermaid.parse in scripts/flowchart.mts.
 */
function emitEdgeLabel(label: string): string {
  let text = label.replace(/[\r\n|]/g, ' ').replace(/"/g, "'").trim()
  if (!text) return ''
  if (/[[\](){}]/.test(text)) text = JSON.stringify(text)
  return text
}

function shapeWrap(shape: FlowNodeShape, label: string): string {
  const text = emitLabel(label)
  switch (shape) {
    case 'stadium':
      return `([${text}])`
    case 'rounded':
      return `(${text})`
    case 'circle':
      return `((${text}))`
    case 'diamond':
      return `{${text}}`
    case 'hexagon':
      return `{{${text}}}`
    case 'parallelogram':
      return `[/${text}/]`
    case 'parallelogramAlt':
      return `[\\${text}\\]`
    case 'rect':
    default:
      return `[${text}]`
  }
}

function edgeOpText(edge: FlowEdge): string {
  const { style, arrows } = edge
  if (style === 'dashed') {
    if (arrows === 'both') return '<-.->'
    if (arrows === 'none') return '-.-'
    return '-.->'
  }
  if (style === 'thick') {
    if (arrows === 'both') return '<==>'
    if (arrows === 'none') return '==='
    return '==>'
  }
  if (arrows === 'both') return '<-->'
  if (arrows === 'none') return '---'
  return '-->'
}

export function serializeFlowchart(graph: FlowGraph): string {
  const out: string[] = []
  const prelude = graph.extras.filter((l) => l.startsWith('%%{'))
  const trailing = graph.extras.filter((l) => !l.startsWith('%%{'))
  out.push(...prelude)
  out.push(`flowchart ${graph.dir}`)

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))
  const meta: MetaPos = {}
  let hasMeta = false
  for (const node of graph.nodes) {
    if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
      const box: number[] = [Math.round(node.x as number), Math.round(node.y as number)]
      if (Number.isFinite(node.w)) box.push(Math.round(node.w as number))
      if (Number.isFinite(node.h)) box.push(Math.round(node.h as number))
      meta[node.id] = box
      hasMeta = true
    }
  }
  if (hasMeta) out.push(`${META_PREFIX}${JSON.stringify({ v: 1, n: meta })}`)

  const emitted = new Set<string>()
  const token = (id: string): string => {
    if (emitted.has(id)) return id
    emitted.add(id)
    const node = nodeMap.get(id)
    if (!node) return id
    const cls = node.cls ? `:::${node.cls}` : ''
    if (!node.explicit) return `${id}${cls}`
    return `${id}${shapeWrap(node.shape, node.label)}${cls}`
  }

  const inEdges = new Set<string>()
  for (const edge of graph.edges) {
    inEdges.add(edge.from)
    inEdges.add(edge.to)
  }
  for (const node of graph.nodes) {
    if (!inEdges.has(node.id)) out.push(`    ${token(node.id)}`)
  }
  for (const edge of graph.edges) {
    const label = edge.label ? `|${emitEdgeLabel(edge.label)}|` : ''
    out.push(`    ${token(edge.from)} ${edgeOpText(edge)}${label} ${token(edge.to)}`)
  }
  out.push(...trailing)
  return out.join('\n')
}

/** Starter diagram for the `插入流程图…` command. */
export const FLOW_TEMPLATE = [
  'flowchart TD',
  '    A([开始]) --> B[处理]',
  '    B --> C{判断?}',
  '    C -->|是| D([结束])',
  '    C -->|否| B',
].join('\n')

/** Generates the next free node id (A..Z, A1.., skipping mermaid keywords). */
export function nextFlowNodeId(used: Iterable<string>): string {
  const set = used instanceof Set ? used : new Set(used)
  for (let i = 0; i < 26 * 40; i += 1) {
    const letter = String.fromCharCode(65 + (i % 26))
    const suffix = Math.floor(i / 26)
    const id = suffix === 0 ? letter : `${letter}${suffix}`
    if (!set.has(id) && !RESERVED_IDS.has(id.toLowerCase())) return id
  }
  return `node${Date.now()}`
}
