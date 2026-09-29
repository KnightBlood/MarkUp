import { JSDOM } from 'jsdom'
import {
  FLOW_TEMPLATE,
  nextFlowNodeId,
  parseFlowchart,
  serializeFlowchart,
  type FlowGraph,
} from '../src/flowchartCodec'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function parseOk(code: string): FlowGraph {
  const result = parseFlowchart(code)
  assert(result.ok, `expected parse ok, got ${result.ok ? '' : result.reason}: ${code}`)
  return result.graph
}

// --- text-level parsing -----------------------------------------------------

const basic = parseOk(
  [
    'flowchart TD',
    '    A([开始]) --> B[处理 数据]',
    '    B --> C{判断?}',
    '    C -->|是| D([结束])',
    '    C -- 否 --> B',
    '    E((圆)) ==> F[/平行/]',
    '    G{{六边形}} -.-> H[矩形]',
    '    I[独立节点]',
    '    D --> I',
  ].join('\n'),
)
assert(basic.dir === 'TD', 'dir TD')
assert(basic.nodes.length === 9, `nodes: ${basic.nodes.length}`)
const byId = new Map(basic.nodes.map((n) => [n.id, n]))
assert(byId.get('A')?.shape === 'stadium' && byId.get('A')?.label === '开始', 'A stadium/开始')
assert(byId.get('B')?.shape === 'rect' && byId.get('B')?.label === '处理 数据', 'B rect')
assert(byId.get('C')?.shape === 'diamond', 'C diamond')
assert(byId.get('E')?.shape === 'circle', 'E circle')
assert(byId.get('F')?.shape === 'parallelogram', 'F parallelogram')
assert(byId.get('G')?.shape === 'hexagon', 'G hexagon')
assert(byId.get('I')?.explicit === true, 'I explicit (declared with wrapper)')
assert(basic.edges.length === 7, `edges: ${basic.edges.length}`)
const edgeC = basic.edges.find((e) => e.from === 'C' && e.label === '是')
assert(edgeC && edgeC.style === 'solid' && edgeC.arrows === 'forward', 'C pipe label')
const edgeC2 = basic.edges.find((e) => e.from === 'C' && e.label === '否')
assert(edgeC2, 'C text-form label')
const edgeE = basic.edges.find((e) => e.from === 'E')
assert(edgeE?.style === 'thick', 'E thick')
const edgeG = basic.edges.find((e) => e.from === 'G')
assert(edgeG?.style === 'dashed', 'G dashed')

// extras + metadata + class
const rich = parseOk(
  [
    '%%{init: {"theme":"neutral"}}%%',
    'flowchart LR',
    '    %%x6:{"v":1,"n":{"A":[10,20,120,48],"B":[200,30]}}',
    '    %% 普通注释',
    '    A([开始]):::c1 --> B{判断}',
    '    B -->|出边| C[收尾]',
    '    classDef c1 fill:#f9f,stroke:#333',
    '    style B fill:#eef',
    '    linkStyle 0 stroke:#f00',
  ].join('\n'),
)
assert(rich.dir === 'LR', 'dir LR')
assert(rich.extras.length === 5, `extras: ${rich.extras.length} -> ${JSON.stringify(rich.extras)}`)
const aNode = rich.nodes.find((n) => n.id === 'A')
assert(aNode?.cls === 'c1', 'A class')
assert(aNode?.x === 10 && aNode?.y === 20 && aNode?.w === 120 && aNode?.h === 48, 'A meta box')
assert(rich.nodes.find((n) => n.id === 'B')?.x === 200, 'B meta pos')

// graph header, missing direction, `;` statements
const old = parseOk('graph TB\n    A --> B; B --> C')
assert(old.dir === 'TB', 'graph TB')
assert(old.edges.length === 2, `semicolon split edges: ${old.edges.length}`)
const noDir = parseOk('flowchart\n    A --> B')
assert(noDir.dir === 'TB', 'default direction TB')

// --- unsupported / not-flowchart ------------------------------------------

const seq = parseFlowchart('sequenceDiagram\n    A->>B: hi')
assert(!seq.ok && seq.reason === 'not-flowchart', 'sequence not-flowchart')
const sub = parseFlowchart('flowchart TD\n    subgraph S [组]\n    A --> B\n    end')
assert(!sub.ok && sub.reason === 'unsupported', 'subgraph unsupported')
const exotic = parseFlowchart('flowchart TD\n    A --x--> B')
assert(!exotic.ok && exotic.reason === 'unsupported', 'x-arrow unsupported')
const hyphen = parseFlowchart('flowchart TD\n    node-1 --> B')
assert(!hyphen.ok && hyphen.reason === 'unsupported', 'hyphen id unsupported')

// malformed metadata is ignored, not fatal
const badMeta = parseOk('flowchart TD\n    %%x6:not-json\n    A --> B')
assert(badMeta.nodes.every((n) => n.x === undefined), 'bad meta ignored')

// --- round-trip -------------------------------------------------------------

const roundSrc = [
  'flowchart TD',
  '    %%x6:{"v":1,"n":{"A":[1,2,120,48],"B":[3,4]}}',
  '    A([开始]) --> B["标签 (带括号)"]',
  '    B -->|是的| C{判断}',
  '    C ==> D[/平行/]',
  '    D -.-> E((圆))',
  '    F[孤立]',
  '    classDef c1 fill:#f9f',
].join('\n')
const g1 = parseOk(roundSrc)
const out1 = serializeFlowchart(g1)
const g2 = parseOk(out1)
assert(g2.dir === g1.dir, 'round dir')
const nodeKey = (g: FlowGraph): string =>
  JSON.stringify(
    [...g.nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => [n.id, n.shape, n.label, n.explicit, n.cls, n.x, n.y, n.w, n.h]),
  )
assert(nodeKey(g2) === nodeKey(g1), `round nodes mismatch:\n${nodeKey(g2)}\nvs\n${nodeKey(g1)}`)
assert(
  JSON.stringify(g2.edges) === JSON.stringify(g1.edges),
  `round edges mismatch:\n${JSON.stringify(g2.edges)}\nvs\n${JSON.stringify(g1.edges)}`,
)
assert(JSON.stringify(g2.extras) === JSON.stringify(g1.extras), 'round extras')
assert(out1.includes('%%x6:'), 'meta emitted')
const richOut = serializeFlowchart(rich)
assert(richOut.startsWith('%%{init'), `init directive emitted before header:\n${richOut}`)
assert(richOut.split('\n')[1].startsWith('flowchart LR'), 'header after prelude')
assert(richOut.split('\n')[2].startsWith('%%x6:'), 'meta right after header')

const out2 = serializeFlowchart(g2)
assert(out2 === out1, `serialize idempotent:\n${out2}\n---\n${out1}`)

// no positions -> no meta line
const noPos = serializeFlowchart(parseOk('flowchart TD\n    A --> B'))
assert(!noPos.includes('%%x6:'), 'no meta without positions')

// --- id generation ----------------------------------------------------------

const id1 = nextFlowNodeId(new Set<string>())
assert(!['O', 'X', 'end', 'graph'].includes(id1), `reserved skipped: ${id1}`)
const used = new Set<string>()
for (let i = 0; i < 30; i += 1) used.add(nextFlowNodeId(used))
assert(used.size === 30, 'unique ids')
assert(!used.has(''), 'non-empty ids')

// --- mermaid acceptance (jsdom) --------------------------------------------

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true })
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
define('DOMParser', dom.window.DOMParser)
define('getComputedStyle', dom.window.getComputedStyle.bind(dom.window))
define('requestAnimationFrame', (cb: FrameRequestCallback) => dom.window.setTimeout(() => cb(Date.now()), 16))
define('cancelAnimationFrame', (id: number) => dom.window.clearTimeout(id))
Object.defineProperty(dom.window.Element.prototype, 'scrollIntoView', { value: () => {} })

const { default: mermaid } = await import('mermaid')
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' })

const parseCases: Array<[string, string]> = [
  ['template', FLOW_TEMPLATE],
  ['rich round-trip', out1],
  ['basic round-trip', serializeFlowchart(basic)],
  ['all shapes', serializeFlowchart(parseOk(
    [
      'flowchart TD',
      '    A([开始]) --> B[矩形]',
      '    B --> C(圆角)',
      '    C --> D{菱形}',
      '    D --> E((圆形))',
      '    E --> F[/平行四边形/]',
      '    F --> G[\\反向平行\\]',
      '    G --> H{{六边形}}',
    ].join('\n'),
  ))],
  ['quoted label', serializeFlowchart(parseOk('flowchart TD\n    A[普通] --> B["含 (括号) 和 [方]"]'))],
  ['edge label quoted', serializeFlowchart({
    dir: 'TD',
    nodes: [
      { id: 'A', shape: 'rect', label: 'A', explicit: false },
      { id: 'B', shape: 'rect', label: 'B', explicit: false },
    ],
    edges: [{ from: 'A', to: 'B', style: 'solid', arrows: 'forward', label: '带"引号"标签' }],
    extras: [],
  })],
  ['arrows both', 'flowchart TD\n    A[矩形] <-->|双向| B[矩形]'],
  ['arrows none labeled', 'flowchart TD\n    A[矩形] ---|无箭头| B[矩形]'],
  ['thick none emit', serializeFlowchart(parseOk('flowchart TD\n    A === B'))],
  ['dashed none emit', serializeFlowchart(parseOk('flowchart TD\n    A -.- B'))],
  ['unicode id', 'flowchart TD\n    开始节点([开始]) --> 处理[处理 数据]'],
  ['cjk label no meta', serializeFlowchart({ ...basic, extras: [] })],
]
for (const [name, code] of parseCases) {
  try {
    await mermaid.parse(code)
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : String(err)
    throw new Error(`mermaid.parse rejected [${name}]:\n${code}\n${msg}`)
  }
}

console.log(
  `SMOKE FLOWCHART OK: basic(${basic.nodes.length}n/${basic.edges.length}e) rich extras=${rich.extras.length} round-trip idempotent mermaid=${parseCases.length}`,
)
