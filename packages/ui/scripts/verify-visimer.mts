/**
 * Visimer x mermaid 12 compatibility probe (decision gate).
 *
 * A. engine layer  — MermaidWysiwygEditor CST/ops against our real formats
 *    (%%x6 coordinate comments, subgraph, sequence). Failures here = do not adopt.
 * B. mermaid 12    — parse + render under jsdom (best effort; report, not fatal).
 * C. canvas layer  — MermaidCanvasView under jsdom (best effort; report, not fatal).
 */
import { JSDOM } from 'jsdom'

type Step = { id: string; ok: boolean; detail: string; fatal: boolean }
const steps: Step[] = []

function check(id: string, ok: boolean, detail: string, fatal = true): void {
  if (!ok && fatal) throw new Error(`${id}: ${detail}`)
  steps.push({ id, ok, detail, fatal })
  if (ok) console.log(`VERIFY ${id} OK: ${detail}`)
  else console.warn(`VERIFY ${id} WARN: ${detail}`)
}

// ---------------------------------------------------------------- A. engine
const { MermaidWysiwygEditor, parse, detectDiagramType } = await import('@visimer/core')

const FLOW = [
  'flowchart TD',
  '%%x6:{"dir":"TB","pos":{"n1":[80,40],"n2":[80,160],"n3":[240,280]}}',
  '  n1["开始"] --> n2{"判断"}',
  '  n2 -->|是 否| n3["执行 (v2)"]',
  '',
].join('\n')

const SUBGRAPH = [
  'flowchart LR',
  '  subgraph SG1[分组一]',
  '    a1["A"] --> a2["B"]',
  '  end',
  '  a2 --> c["C"]',
  '',
].join('\n')

const SEQ = [
  'sequenceDiagram',
  '  participant A as Alice',
  '  participant B as Bob',
  '  A->>B: Hello',
  '  alt 确认',
  '    B-->>A: OK',
  '  else',
  '    B-->>A: retry',
  '  end',
  '',
].join('\n')

// A1: our %%x6 flowchart parses + ops edit it without losing the comment
{
  const info = detectDiagramType('flowchart TD')
  check('A1-detect', info?.id === 'flowchart', `detectDiagramType(flowchart TD) => ${info?.id}`)

  const editor = new MermaidWysiwygEditor({ code: FLOW })
  const graph = editor.result.flowchart
  check(
    'A1-parse',
    graph !== null && graph.nodes.length === 3 && graph.edges.length === 2,
    `nodes=${graph?.nodes.length} edges=${graph?.edges.length}`,
  )

  let changeFired = 0
  let lastOrigin = ''
  const off = editor.on('change', (e) => {
    changeFired += 1
    lastOrigin = e.origin
  })

  const before = editor.code
  const res = editor.dispatch({ type: 'renameNode', id: 'n1', label: '开始啦' })
  check('A1-rename', res !== null && editor.code.includes('n1["开始啦"]'), `rename applied=${res !== null}`)
  check('A1-keep-x6', editor.code.includes('%%x6:'), '%%x6 coordinate comment preserved after op')
  check('A1-keep-label', editor.code.includes('是 否'), 'bare pipe label with space preserved')

  editor.undo()
  check('A1-undo', editor.code === before, 'undo restores original source exactly')
  editor.redo()
  check('A1-redo', editor.code.includes('n1["开始啦"]'), 'redo re-applies')
  editor.undo()
  off()
  check('A1-events', changeFired >= 3, `change events fired=${changeFired} lastOrigin=${lastOrigin}`)
}

// A2: subgraph round-trip + renameSubgraph + ops coexisting with subgraph
{
  const editor = new MermaidWysiwygEditor({ code: SUBGRAPH })
  const graph = editor.result.flowchart
  const sg = graph?.subgraphs[0]
  check(
    'A2-parse',
    graph !== null && graph.subgraphs.length === 1 && sg !== null && sg.title === '分组一',
    `subgraphs=${graph?.subgraphs.length} title=${sg?.title}`,
  )
  const inner = graph?.nodeById.get('a1')
  check('A2-member', inner?.subgraph !== null || inner?.subgraph !== undefined, `a1.subgraph=${inner?.subgraph}`)

  const before = editor.code
  const res = editor.dispatch({ type: 'renameSubgraph', id: sg!.id, title: '新分组' })
  check('A2-rename', res !== null && editor.code.includes('新分组'), 'renameSubgraph rewrote title')
  check('A2-structure', editor.code.includes('subgraph') && editor.code.includes('end'), 'subgraph block intact')
  editor.undo()
  check('A2-undo', editor.code === before, 'undo restores subgraph source')
}

// A3: sequence ops (add message / move / participant / fragment)
{
  const editor = new MermaidWysiwygEditor({ code: SEQ })
  const seq = editor.result.sequence
  check(
    'A3-parse',
    seq !== null && seq.participants.length >= 2 && seq.events.length >= 3,
    `participants=${seq?.participants.length} events=${seq?.events.length}`,
  )

  const before = editor.code
  const addRes = editor.dispatch({ type: 'seq.addMessage', source: 'B', target: 'A', text: 'Done', op: '-->>' })
  check('A3-add-message', addRes !== null && editor.code.includes('B-->>A: Done'), 'seq.addMessage appended')

  const ev1 = editor.result.sequence!.events[0]
  const evLast = editor.result.sequence!.events[editor.result.sequence!.events.length - 1]
  const moveRes = editor.dispatch({ type: 'seq.moveEvent', eventId: ev1.entityId, afterEvent: evLast.entityId })
  check('A3-move', moveRes !== null, 'seq.moveEvent compiled')

  const addRes2 = editor.dispatch({ type: 'seq.addParticipant', name: 'Carol' })
  check('A3-add-participant', addRes2 !== null && editor.code.includes('Carol'), 'seq.addParticipant added')

  editor.undo()
  editor.undo()
  editor.undo()
  check('A3-undo-stack', editor.code === before, 'triple undo restores sequence source')
}

// A4: lossless for foreign/unknown syntax (mermaid 12 block diagram style + our comment)
{
  const weird = ['block-beta', '  columns 1', '  a["hi"]', '', '%%x6:{"keep":true}', ''].join('\n')
  const editor = new MermaidWysiwygEditor({ code: weird })
  check('A4-lossless', editor.code === weird, 'unsupported diagram type kept verbatim')
  const seqParsed = parse(SEQ)
  check('A4-parse-fn', seqParsed.sequence !== null, 'standalone parse() exposes sequence graph')
}

// ------------------------------------------------- B/C: jsdom (non-fatal)
const dom = new JSDOM('<!doctype html><html><body><div id="c"></div></body></html>', { pretendToBeVisual: true })
const define = (key: string, value: unknown): void => {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}
define('window', dom.window)
define('document', dom.window.document)
define('navigator', dom.window.navigator)
define('HTMLElement', dom.window.HTMLElement)
define('Element', dom.window.Element)
define('SVGElement', dom.window.SVGElement)
define('Node', dom.window.Node)
define('MutationObserver', dom.window.MutationObserver)
define('DOMParser', dom.window.DOMParser)
define('getComputedStyle', dom.window.getComputedStyle.bind(dom.window))
define('requestAnimationFrame', (cb: FrameRequestCallback) => dom.window.setTimeout(() => cb(Date.now()), 16))
define('cancelAnimationFrame', (id: number) => dom.window.clearTimeout(id))
define('DOMParser', dom.window.DOMParser)
// jsdom SVG geometry shims (same set proven in ui/pm-k)
{
  const svg = dom.window.SVGElement.prototype as unknown as Record<string, unknown>
  svg.getBBox = () => ({ x: 0, y: 0, width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40 })
  svg.getComputedTextLength = () => 96
  const proto = dom.window.HTMLCanvasElement.prototype as unknown as Record<string, unknown>
  proto.getContext = function (type?: string) {
    if (type !== '2d') return null
    return {
      font: '10px sans-serif',
      save() {},
      restore() {},
      measureText: (text: string) => ({ width: (text ?? '').length * 8 }),
    } as unknown as CanvasRenderingContext2D
  }
}
// mermaid 12 wants CSSStyleSheet / adoptedStyleSheets; visimer uses global CSS.
if (typeof (globalThis as Record<string, unknown>).CSSStyleSheet === 'undefined') {
  class FakeSheet {
    replaceSync(): void {}
    insertRule(): number {
      return 0
    }
    cssRules: unknown[] = []
  }
  define('CSSStyleSheet', FakeSheet)
}
if (typeof (globalThis as Record<string, unknown>).CSS === 'undefined') {
  define('CSS', {
    escape: (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`),
    supports: () => true,
    valid: () => true,
    registerProperty: () => {},
  })
}
try {
  const doc = dom.window.document as unknown as Record<string, unknown>
  if (!('adoptedStyleSheets' in doc)) {
    Object.defineProperty(dom.window.document, 'adoptedStyleSheets', {
      value: [],
      configurable: true,
      writable: true,
    })
  }
} catch {
  /* ignore */
}

// B: mermaid 12 parse + render
try {
  const mermaid = (await import('mermaid')).default
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' })
  for (const [id, code] of [
    ['B1-flow-x6', FLOW],
    ['B1-subgraph', SUBGRAPH],
    ['B1-sequence', SEQ],
  ] as const) {
    try {
      await mermaid.parse(code)
      check(id, true, 'mermaid 12 parse accepted', false)
    } catch (error) {
      check(id, false, `mermaid 12 parse rejected: ${(error as Error).message.slice(0, 140)}`, false)
    }
  }
  try {
    const { svg } = await mermaid.render('vis-probe', SEQ)
    check('B2-render-seq', svg.includes('<svg'), 'mermaid.render(sequence) produced svg under jsdom', false)
  } catch (error) {
    check('B2-render-seq', false, `render failed under jsdom: ${(error as Error).message.slice(0, 140)}`, false)
  }
} catch (error) {
  check('B0-import', false, `mermaid import failed: ${(error as Error).message}`, false)
}

// C: MermaidCanvasView under jsdom
try {
  const { MermaidCanvasView } = await import('@visimer/dom')
  const mermaid = (await import('mermaid')).default
  const editor = new MermaidWysiwygEditor({ code: SEQ })
  const container = dom.window.document.getElementById('c') as HTMLElement
  const view = new MermaidCanvasView({ editor, container, mermaid })
  let renderOk: boolean | null = null
  view.on('render', (e) => {
    renderOk = e.ok
  })
  await view.render()
  check(
    'C1-canvas',
    renderOk === true && container.querySelector('svg') !== null,
    `jsdom canvas render ok=${renderOk} svg=${container.querySelector('svg') !== null} err=${view.renderError?.slice(0, 120) ?? '-'}`,
    false,
  )
  view.setReadOnly(true)
} catch (error) {
  check('C1-canvas', false, `MermaidCanvasView failed under jsdom: ${(error as Error).message.slice(0, 160)}`, false)
}

// ------------------------------------------------------------- summary
const fatalFails = steps.filter((s) => s.fatal && !s.ok)
const warns = steps.filter((s) => !s.fatal && !s.ok)
if (fatalFails.length > 0) {
  console.error(`SMOKE VISIMER FAILED: ${fatalFails.map((s) => `${s.id}(${s.detail})`).join('; ')}`)
  process.exit(1)
}
console.log(
  `SMOKE VISIMER OK: engine=${steps.filter((s) => s.fatal && s.ok).length} checks` +
    ` / render-warnings=${warns.length}${warns.length ? ` [${warns.map((s) => s.id).join(',')}]` : ''}`,
)
