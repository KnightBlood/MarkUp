import { el } from '../dom'
import {
  FLOW_TEMPLATE,
  nextFlowNodeId,
  parseFlowchart,
  serializeFlowchart,
  type FlowDir,
  type FlowEdge,
  type FlowEdgeArrows,
  type FlowEdgeStyle,
  type FlowGraph,
  type FlowNode,
  type FlowNodeShape,
} from '../../../core/src/flowchartCodec'
import type { Edge as X6Edge, Graph as X6Graph, Node as X6Node } from '@antv/x6'
import type { DiagramTypeInfo, MermaidWysiwygEditor as VisEditor, ShapeId } from '@visimer/core'
import type { MermaidCanvasView as VisView } from '@visimer/dom'

export interface DiagramEditorOpenOptions {
  /** mermaid flowchart source. Empty/falsy starts from FLOW_TEMPLATE. */
  code?: string
  title?: string
  onConfirm: (code: string) => void
  onCancel?: () => void
}

export interface DiagramEditorApi {
  el: HTMLElement
  open: (options?: DiagramEditorOpenOptions) => void
  close: () => void
  isOpen: () => boolean
}

type EditorMode = 'canvas' | 'source'
type StatusKind = 'info' | 'ok' | 'bad'

interface NodeFlowData {
  shape: FlowNodeShape
  explicit: boolean
  cls?: string | null
}

interface EdgeFlowData {
  style: FlowEdgeStyle
  arrows: FlowEdgeArrows
  label?: string | null
}

const SHAPE_SIZE: Record<FlowNodeShape, { w: number; h: number }> = {
  rect: { w: 132, h: 48 },
  rounded: { w: 132, h: 48 },
  stadium: { w: 132, h: 48 },
  diamond: { w: 132, h: 64 },
  circle: { w: 72, h: 72 },
  hexagon: { w: 132, h: 52 },
  parallelogram: { w: 140, h: 48 },
  parallelogramAlt: { w: 140, h: 48 },
}

const SHAPE_LABELS: Array<{ value: FlowNodeShape; label: string }> = [
  { value: 'rect', label: '矩形' },
  { value: 'rounded', label: '圆角矩形' },
  { value: 'stadium', label: '胶囊' },
  { value: 'diamond', label: '菱形' },
  { value: 'circle', label: '圆形' },
  { value: 'hexagon', label: '六边形' },
  { value: 'parallelogram', label: '平行四边形' },
  { value: 'parallelogramAlt', label: '反向平行四边形' },
]

const DIR_OPTIONS: Array<{ value: FlowDir; label: string }> = [
  { value: 'TD', label: '上下 (TD)' },
  { value: 'TB', label: '上下 (TB)' },
  { value: 'LR', label: '左右 (LR)' },
  { value: 'RL', label: '左右 (RL)' },
  { value: 'BT', label: '下上 (BT)' },
]

const EDGE_STYLE_OPTIONS: Array<{ value: FlowEdgeStyle; label: string }> = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'thick', label: '粗线' },
]

const EDGE_ARROWS_OPTIONS: Array<{ value: FlowEdgeArrows; label: string }> = [
  { value: 'forward', label: '单向 →' },
  { value: 'both', label: '双向 ↔' },
  { value: 'none', label: '无箭头' },
]

const ELK_DIR: Record<FlowDir, string> = {
  TD: 'DOWN',
  TB: 'DOWN',
  LR: 'RIGHT',
  RL: 'LEFT',
  BT: 'UP',
}

function readFlowData<T>(data: unknown): T {
  const record = (data ?? {}) as { flow?: T }
  return (record.flow ?? {}) as T
}

function diamondPoints(w: number, h: number): string {
  return `0,${h / 2} ${w / 2},0 ${w},${h / 2} ${w / 2},${h}`
}

function hexagonPoints(w: number, h: number): string {
  const l = w * 0.22
  const r = w * 0.78
  return `0,${h / 2} ${l},0 ${r},0 ${w},${h / 2} ${r},${h} ${l},${h}`
}

function parallelogramPath(w: number, h: number, reverse: boolean): string {
  const lean = w * 0.22
  return reverse
    ? `M 0 0 L ${w - lean} 0 L ${w} ${h} L ${lean} ${h} Z`
    : `M ${lean} 0 L ${w} 0 L ${w - lean} ${h} L 0 ${h} Z`
}

function nodeMetadata(node: FlowNode, x: number, y: number): Record<string, unknown> {
  const size = SHAPE_SIZE[node.shape] ?? SHAPE_SIZE.rect
  const w = Number.isFinite(node.w) ? (node.w as number) : size.w
  const h = Number.isFinite(node.h) ? (node.h as number) : size.h
  const body: Record<string, unknown> = {}
  let shape = 'rect'
  let path: string | undefined
  switch (node.shape) {
    case 'rounded':
      shape = 'rect'
      body.rx = 10
      body.ry = 10
      break
    case 'stadium':
      shape = 'rect'
      body.rx = h / 2
      body.ry = h / 2
      break
    case 'circle':
      shape = 'ellipse'
      break
    case 'diamond':
      shape = 'polygon'
      body.refPoints = diamondPoints(w, h)
      break
    case 'hexagon':
      shape = 'polygon'
      body.refPoints = hexagonPoints(w, h)
      break
    case 'parallelogram':
      shape = 'path'
      path = parallelogramPath(w, h, false)
      break
    case 'parallelogramAlt':
      shape = 'path'
      path = parallelogramPath(w, h, true)
      break
    default:
      shape = 'rect'
      break
  }
  const meta: Record<string, unknown> = {
    id: node.id,
    x,
    y,
    width: w,
    height: h,
    shape,
    attrs: {
      body: {
        fill: 'var(--bg-raise, #ffffff)',
        stroke: '#8a93a6',
        strokeWidth: 1.5,
        ...body,
      },
      label: {
        text: node.label,
        textWrap: { width: Math.max(40, w - 20), height: Math.max(20, h - 8), ellipsis: true },
      },
    },
    data: {
      flow: {
        shape: node.shape,
        explicit: node.explicit,
        cls: node.cls ?? null,
      } satisfies NodeFlowData,
    },
  }
  if (path !== undefined) meta.path = path
  return meta
}

function edgeMetadata(edge: FlowEdge): Record<string, unknown> {
  const line: Record<string, unknown> = { stroke: '#7b8496' }
  if (edge.style === 'dashed') line.strokeDasharray = '6 4'
  if (edge.style === 'thick') line.strokeWidth = 3.5
  if (edge.arrows === 'both') line.sourceMarker = { name: 'block', width: 10, height: 8 }
  if (edge.arrows !== 'none') line.targetMarker = { name: 'block', width: 10, height: 8 }
  return {
    source: { cell: edge.from },
    target: { cell: edge.to },
    connector: { name: 'rounded' },
    attrs: { line },
    labels: edge.label
      ? [{ position: { distance: 0.5 }, attrs: { label: { text: edge.label } } }]
      : [],
    data: {
      flow: {
        style: edge.style,
        arrows: edge.arrows,
        label: edge.label ?? null,
      } satisfies EdgeFlowData,
    },
  }
}

let x6Promise: Promise<typeof import('@antv/x6') | null> | null = null

async function ensureX6(): Promise<typeof import('@antv/x6') | null> {
  if (!x6Promise) {
    x6Promise = (async () => {
      try {
        return await import('@antv/x6')
      } catch {
        // Node/tsx resolves the package "main" (a CJS file) as ESM and fails;
        // the pre-built es/ entry is real ESM. Bundlers resolve "module" anyway.
        try {
          return (await import('@antv/x6/es/index.js')) as unknown as typeof import('@antv/x6')
        } catch (error) {
          console.warn('[markup] @antv/x6 加载失败', error)
          return null
        }
      }
    })()
  }
  return x6Promise
}

type VisModules = { core: typeof import('@visimer/core'); dom: typeof import('@visimer/dom') }
let visPromise: Promise<VisModules | null> | null = null

async function ensureVisimer(): Promise<VisModules | null> {
  if (!visPromise) {
    visPromise = (async () => {
      try {
        const [core, dom] = await Promise.all([import('@visimer/core'), import('@visimer/dom')])
        return { core, dom }
      } catch (error) {
        console.warn('[markup] @visimer 加载失败', error)
        return null
      }
    })()
  }
  return visPromise
}

function mermaidHeader(code: string): string {
  const line = code.split('\n').find((candidate) => candidate.trim().length > 0) ?? ''
  return line.trim()
}

const VIS_SHAPE: Record<FlowNodeShape, ShapeId> = {
  rect: 'rect',
  rounded: 'round',
  stadium: 'stadium',
  diamond: 'diamond',
  circle: 'circle',
  hexagon: 'hexagon',
  parallelogram: 'lean_r',
  parallelogramAlt: 'lean_l',
}

function editableDiagramType(vis: VisModules, code: string): DiagramTypeInfo | null {
  const info = vis.core.detectDiagramType(mermaidHeader(code))
  return info && info.capability === 'edit' ? info : null
}

export function createDiagramEditor(): DiagramEditorApi {
  let openState: DiagramEditorOpenOptions | null = null
  let mode: EditorMode = 'source'
  let graph: X6Graph | null = null
  let visEngine: VisEditor | null = null
  let visView: VisView | null = null
  let visKind: 'flow' | 'seq' | 'other' = 'other'
  let visToolOff: (() => void) | null = null
  let flowDir: FlowDir = 'TD'
  let flowExtras: string[] = []
  let pendingSource: X6Node | null = null
  let connectMode = false
  let building = false

  const titleEl = el('h2', { class: 'settings__title', text: '编辑流程图' })
  const closeBtn = el('button', {
    class: 'settings__close',
    type: 'button',
    text: '×',
    'aria-label': '关闭',
    onclick: () => close(),
  })

  const statusEl = el('div', { class: 'formula__status diagram__status', text: '' })

  const modeCanvasBtn = el('button', {
    class: 'diagram__mode',
    type: 'button',
    text: '画布',
    onclick: () => {
      if (mode !== 'canvas') void enterCanvas(true)
    },
  })
  const modeSourceBtn = el('button', {
    class: 'diagram__mode',
    type: 'button',
    text: '源码',
    onclick: () => switchToSource(),
  })

  const shapeButtons: HTMLButtonElement[] = []
  const shapeButtonsEls = SHAPE_LABELS.map((spec) => {
    const btn = el('button', {
      class: 'diagram__shape',
      type: 'button',
      text: spec.label,
      title: `添加${spec.label}节点`,
      onclick: () => addNode(spec.value),
    })
    shapeButtons.push(btn)
    return btn
  })

  const connectBtn = el('button', {
    class: 'diagram__shape',
    type: 'button',
    text: '连线',
    title: '依次点击两个节点连线',
    onclick: () => toggleConnect(),
  })
  const deleteBtn = el('button', {
    class: 'diagram__shape',
    type: 'button',
    text: '删除',
    title: '删除选中的节点或连线（Delete）',
    onclick: () => deleteSelection(),
  })
  const undoBtn = el('button', {
    class: 'diagram__shape',
    type: 'button',
    text: '撤销',
    onclick: () => {
      if (visEngine) visEngine.undo()
      else graph?.undo()
    },
  })
  const redoBtn = el('button', {
    class: 'diagram__shape',
    type: 'button',
    text: '重做',
    onclick: () => {
      if (visEngine) visEngine.redo()
      else graph?.redo()
    },
  })
  const layoutBtn = el('button', {
    class: 'diagram__shape',
    type: 'button',
    text: '自动布局',
    onclick: () => void autoLayout(false),
  })
  const dirSelect = el('select', {
    class: 'settings__input diagram__dir',
    'aria-label': '流程图方向',
    onchange: () => {
      flowDir = (dirSelect.value || 'TD') as FlowDir
    },
  }) as HTMLSelectElement
  for (const opt of DIR_OPTIONS) {
    dirSelect.append(el('option', { value: opt.value, text: opt.label }))
  }
  dirSelect.value = 'TD'

  const historyControls: Array<HTMLElement | { disabled: boolean }> = [undoBtn, redoBtn]

  const canvasHost = el('div', { class: 'diagram__canvas', 'aria-label': '流程图画布' })
  const sourceArea = el('textarea', {
    class: 'formula__source diagram__source',
    rows: '14',
    spellcheck: 'false',
    placeholder: 'flowchart TD\n    A[开始] --> B[结束]',
    'aria-label': 'mermaid 流程图源码',
    oninput: () => {
      statusEl.textContent = ''
      statusEl.className = 'formula__status diagram__status'
    },
  }) as HTMLTextAreaElement

  const propsHost = el('div', { class: 'diagram__props', hidden: true })

  const cancelBtn = el('button', {
    class: 'btn formula__btn',
    type: 'button',
    text: '取消',
    onclick: () => close(),
  })
  const confirmBtn = el('button', {
    class: 'btn btn--primary formula__btn formula__btn--primary',
    type: 'button',
    text: '应用',
    onclick: () => {
      void confirm()
    },
  })

  const panel = el(
    'div',
    { class: 'settings__panel diagram__panel', role: 'dialog', 'aria-label': '流程图编辑器' },
    el('header', { class: 'settings__header' }, titleEl, closeBtn),
    el(
      'div',
      { class: 'settings__body diagram__body' },
      el(
        'div',
        { class: 'diagram__toolbar' },
        el('div', { class: 'diagram__modes' }, modeCanvasBtn, modeSourceBtn),
        el('div', { class: 'diagram__sep' }),
        ...shapeButtonsEls,
        el('div', { class: 'diagram__sep' }),
        connectBtn,
        deleteBtn,
        el('div', { class: 'diagram__sep' }),
        undoBtn,
        redoBtn,
        layoutBtn,
        el('div', { class: 'diagram__sep' }),
        el('span', { class: 'diagram__hint', text: '方向' }),
        dirSelect,
      ),
      canvasHost,
      sourceArea,
      propsHost,
      statusEl,
      el(
        'footer',
        { class: 'diagram__footer' },
        el('span', { class: 'diagram__hint', text: 'Ctrl+Enter 应用 · Esc 取消' }),
        el('div', { class: 'formula__spacer' }),
        cancelBtn,
        confirmBtn,
      ),
    ),
  )
  const root = el('div', { class: 'settings diagram', hidden: true }, panel)

  function setStatus(text: string, kind: StatusKind = 'info'): void {
    statusEl.textContent = text
    statusEl.className =
      kind === 'ok'
        ? 'formula__status formula__status--ok diagram__status'
        : kind === 'bad'
          ? 'formula__status formula__status--bad diagram__status'
          : 'formula__status diagram__status'
  }

  function updateModeButtons(): void {
    modeCanvasBtn.classList.toggle('is-active', mode === 'canvas')
    modeSourceBtn.classList.toggle('is-active', mode === 'source')
    modeCanvasBtn.disabled = mode === 'canvas'
    modeSourceBtn.disabled = mode === 'source'
    const inCanvas = mode === 'canvas'
    const visActive = visEngine !== null
    const visFlow = visActive && visKind === 'flow'
    for (const control of shapeButtonsEls) {
      if ('disabled' in control) control.disabled = !inCanvas || (visActive && !visFlow)
    }
    connectBtn.disabled = !inCanvas || (visActive && !visFlow)
    deleteBtn.disabled = !inCanvas
    layoutBtn.disabled = !inCanvas || visActive
    dirSelect.disabled = !inCanvas || visActive
    for (const control of historyControls) {
      if ('disabled' in control) control.disabled = !inCanvas
    }
  }

  function setMode(next: EditorMode): void {
    mode = next
    canvasHost.hidden = next !== 'canvas'
    sourceArea.hidden = next !== 'source'
    updateModeButtons()
    if (next === 'canvas' && graph) {
      try {
        graph.resize()
      } catch {
        /* ignore */
      }
    }
  }

  function showProps(html: HTMLElement | null): void {
    if (!html) {
      propsHost.replaceChildren()
      propsHost.hidden = true
      return
    }
    propsHost.replaceChildren(html)
    propsHost.hidden = false
  }

  function propField(labelText: string, input: HTMLElement): HTMLElement {
    return el('label', { class: 'diagram__field' }, el('span', { text: labelText }), input)
  }

  function readNodeLabel(node: X6Node): string {
    const value = node.getAttrByPath<string>('label/text')
    return typeof value === 'string' ? value : ''
  }

  function nodeFlow(node: X6Node): NodeFlowData {
    const flow = readFlowData<NodeFlowData>(node.getData())
    return {
      shape: flow.shape ?? 'rect',
      explicit: flow.explicit ?? true,
      cls: flow.cls ?? null,
    }
  }

  function edgeFlow(edge: X6Edge): EdgeFlowData {
    const flow = readFlowData<EdgeFlowData>(edge.getData())
    return {
      style: flow.style ?? 'solid',
      arrows: flow.arrows ?? 'forward',
      label: flow.label ?? null,
    }
  }

  function showNodeProps(node: X6Node): void {
    const flow = nodeFlow(node)
    const labelInput = el('input', {
      class: 'settings__input',
      type: 'text',
      value: readNodeLabel(node),
      'aria-label': '节点文字',
      oninput: () => {
        const text = labelInput.value
        node.setAttrByPath('label/text', text)
        const updated: NodeFlowData = { ...nodeFlow(node), explicit: true }
        node.setData({ ...node.getData(), flow: updated })
      },
    }) as HTMLInputElement
    const shapeSelect = el('select', {
      class: 'settings__input',
      'aria-label': '节点形状',
      onchange: () => changeNodeShape(node, shapeSelect.value as FlowNodeShape),
    }) as HTMLSelectElement
    for (const spec of SHAPE_LABELS) {
      shapeSelect.append(el('option', { value: spec.value, text: spec.label }))
    }
    shapeSelect.value = flow.shape
    showProps(
      el(
        'div',
        { class: 'diagram__props-inner' },
        propField('文字', labelInput),
        propField('形状', shapeSelect),
        el('span', { class: 'diagram__hint', text: `ID：${node.id}` }),
      ),
    )
  }

  function showEdgeProps(edge: X6Edge): void {
    const flow = edgeFlow(edge)
    const labelInput = el('input', {
      class: 'settings__input',
      type: 'text',
      value: flow.label ?? '',
      'aria-label': '连线文字',
      oninput: () => applyEdgeLabel(edge, labelInput.value),
    }) as HTMLInputElement
    const styleSelect = el('select', {
      class: 'settings__input',
      'aria-label': '连线样式',
      onchange: () => applyEdgeStyle(edge, styleSelect.value as FlowEdgeStyle),
    }) as HTMLSelectElement
    for (const spec of EDGE_STYLE_OPTIONS) {
      styleSelect.append(el('option', { value: spec.value, text: spec.label }))
    }
    styleSelect.value = flow.style
    const arrowsSelect = el('select', {
      class: 'settings__input',
      'aria-label': '箭头方向',
      onchange: () => applyEdgeArrows(edge, arrowsSelect.value as FlowEdgeArrows),
    }) as HTMLSelectElement
    for (const spec of EDGE_ARROWS_OPTIONS) {
      arrowsSelect.append(el('option', { value: spec.value, text: spec.label }))
    }
    arrowsSelect.value = flow.arrows
    showProps(
      el(
        'div',
        { class: 'diagram__props-inner' },
        propField('文字', labelInput),
        propField('线型', styleSelect),
        propField('箭头', arrowsSelect),
      ),
    )
  }

  function applyEdgeLabel(edge: X6Edge, text: string): void {
    const flow = edgeFlow(edge)
    edge.setData({ ...edge.getData(), flow: { ...flow, label: text || null } })
    edge.setLabels(
      text
        ? [{ position: { distance: 0.5 }, attrs: { label: { text } } }]
        : [],
    )
  }

  function applyEdgeStyle(edge: X6Edge, style: FlowEdgeStyle): void {
    const flow = edgeFlow(edge)
    edge.setData({ ...edge.getData(), flow: { ...flow, style } })
    edge.attr('line/strokeDasharray', style === 'dashed' ? '6 4' : null)
    edge.attr('line/strokeWidth', style === 'thick' ? 3.5 : null)
  }

  function applyEdgeArrows(edge: X6Edge, arrows: FlowEdgeArrows): void {
    const flow = edgeFlow(edge)
    edge.setData({ ...edge.getData(), flow: { ...flow, arrows } })
    edge.attr('line/sourceMarker', arrows === 'both' ? { name: 'block', width: 10, height: 8 } : null)
    edge.attr(
      'line/targetMarker',
      arrows === 'none' ? null : { name: 'block', width: 10, height: 8 },
    )
  }

  function changeNodeShape(node: X6Node, shape: FlowNodeShape): void {
    if (!graph) return
    const flow = nodeFlow(node)
    if (flow.shape === shape) return
    const pos = node.getPosition()
    const size = node.getSize()
    const label = readNodeLabel(node)
    const keptSize = isRectFamily(shape) && isRectFamily(flow.shape)
    const next: FlowNode = {
      id: node.id,
      shape,
      label,
      explicit: true,
      cls: flow.cls ?? undefined,
      w: keptSize ? size.width : undefined,
      h: keptSize ? size.height : undefined,
    }
    const connected: FlowEdge[] = []
    for (const edge of graph.getConnectedEdges(node)) {
      const from = edge.getSourceCellId()
      const to = edge.getTargetCellId()
      if (!from || !to) continue
      const eflow = edgeFlow(edge)
      connected.push({
        from,
        to,
        style: eflow.style,
        arrows: eflow.arrows,
        label: eflow.label ?? undefined,
      })
    }
    graph.removeCell(node)
    const meta = nodeMetadata(next, pos.x, pos.y)
    const created = graph.addNode(meta as never)
    for (const edge of connected) graph.addEdge(edgeMetadata(edge) as never)
    graph.select(created)
    showNodeProps(created)
    setStatus(`已将 ${next.id} 改为${SHAPE_LABELS.find((s) => s.value === shape)?.label ?? shape}`, 'ok')
  }

  function isRectFamily(shape: FlowNodeShape): boolean {
    return shape === 'rect' || shape === 'rounded' || shape === 'stadium'
  }

  function addNode(shape: FlowNodeShape): void {
    if (visEngine) {
      if (!visView || visKind !== 'flow') return
      visView.addNode(VIS_SHAPE[shape])
      setStatus(`已添加 ${SHAPE_LABELS.find((s) => s.value === shape)?.label ?? shape} 节点`, 'ok')
      return
    }
    if (!graph || mode !== 'canvas') return
    const ids = graph.getNodes().map((node) => node.id)
    const id = nextFlowNodeId(ids)
    const index = ids.length
    const rect = canvasHost.getBoundingClientRect()
    const size = SHAPE_SIZE[shape]
    let x = 40 + (index % 4) * (size.w + 40)
    let y = 40 + Math.floor(index / 4) * (size.h + 44)
    if (rect.width > 120 && rect.height > 80) {
      const cols = Math.max(1, Math.floor((rect.width - 60) / (size.w + 40)))
      x = 30 + (index % cols) * (size.w + 40)
      y = 30 + Math.floor(index / cols) * (size.h + 44)
    }
    const node: FlowNode = { id, shape, label: id, explicit: true }
    const created = graph.addNode(nodeMetadata(node, x, y) as never)
    graph.select(created)
    showNodeProps(created)
    setStatus(`已添加节点 ${id}`, 'ok')
  }

  function toggleConnect(): void {
    if (visEngine) {
      if (!visView || visKind !== 'flow') return
      const next = visView.currentTool === 'connect' ? 'select' : 'connect'
      visView.setTool(next)
      connectBtn.classList.toggle('is-active', next === 'connect')
      setStatus(
        next === 'connect'
          ? '连线中：从起点节点拖到终点节点（Esc 取消）'
          : '已退出连线模式',
        next === 'connect' ? 'info' : 'ok',
      )
      return
    }
    if (!graph || mode !== 'canvas') return
    connectMode = !connectMode
    pendingSource = null
    connectBtn.classList.toggle('is-active', connectMode)
    setStatus(
      connectMode ? '连线中：点击起点节点，再点击终点节点（Esc 取消）' : '已退出连线模式',
      connectMode ? 'info' : 'ok',
    )
  }

  function cancelConnect(): void {
    if (visEngine && visView) {
      if (visView.currentTool === 'connect') visView.setTool('select')
      connectBtn.classList.remove('is-active')
      setStatus('已取消连线', 'ok')
      return
    }
    if (!connectMode && !pendingSource) return
    connectMode = false
    pendingSource = null
    connectBtn.classList.remove('is-active')
    setStatus('已取消连线', 'ok')
  }

  function handleConnectClick(node: X6Node): void {
    if (!graph) return
    if (!pendingSource) {
      pendingSource = node
      setStatus(`起点 ${node.id}：请点击终点节点`, 'info')
      return
    }
    if (pendingSource.id === node.id) {
      pendingSource = null
      setStatus('已取消连线', 'ok')
      return
    }
    const from = pendingSource.id
    const to = node.id
    const dup = graph
      .getEdges()
      .some((edge) => edge.getSourceCellId() === from && edge.getTargetCellId() === to)
    if (dup) {
      setStatus(`${from} → ${to} 已存在连线`, 'bad')
      pendingSource = null
      return
    }
    const meta = edgeMetadata({ from, to, style: 'solid', arrows: 'forward' })
    const created = graph.addEdge(meta as never)
    pendingSource = null
    setStatus(`已连线 ${from} → ${to}`, 'ok')
    if (created) {
      graph.select(created)
      showEdgeProps(created)
    }
  }

  function deleteSelection(): void {
    if (visEngine) {
      const selected = visEngine.selection
      if (!selected.length) {
        setStatus('先选中要删除的节点或连线', 'bad')
        return
      }
      visEngine.deleteEntities([...selected])
      setStatus(`已删除 ${selected.length} 项`, 'ok')
      return
    }
    if (!graph || mode !== 'canvas') return
    const cells = graph.getSelectedCells()
    if (!cells.length) {
      setStatus('先选中要删除的节点或连线', 'bad')
      return
    }
    for (const cell of cells) graph.removeCell(cell)
    showProps(null)
    setStatus(`已删除 ${cells.length} 项`, 'ok')
  }

  function readGraph(): FlowGraph | null {
    if (!graph) return null
    const nodes: FlowNode[] = []
    for (const cell of graph.getNodes()) {
      const pos = cell.getPosition()
      const size = cell.getSize()
      const flow = nodeFlow(cell)
      nodes.push({
        id: cell.id,
        shape: flow.shape,
        label: readNodeLabel(cell) || cell.id,
        explicit: flow.explicit,
        cls: flow.cls ?? undefined,
        x: pos.x,
        y: pos.y,
        w: size.width,
        h: size.height,
      })
    }
    const edges: FlowEdge[] = []
    for (const cell of graph.getEdges()) {
      const from = cell.getSourceCellId()
      const to = cell.getTargetCellId()
      if (!from || !to) continue
      const flow = edgeFlow(cell)
      const labels = cell.getLabels()
      const rendered = labels[0]?.attrs?.label?.text
      const label =
        typeof rendered === 'string' && rendered.length > 0
          ? rendered
          : flow.label ?? undefined
      edges.push({ from, to, style: flow.style, arrows: flow.arrows, label })
    }
    return { dir: flowDir, nodes, edges, extras: flowExtras }
  }

  function currentCode(): string {
    if (visEngine) return visEngine.code
    if (mode === 'canvas') {
      const graphModel = readGraph()
      if (graphModel) return serializeFlowchart(graphModel)
    }
    return sourceArea.value
  }

  function buildCells(parsed: FlowGraph): void {
    if (!graph) return
    building = true
    try {
      graph.clearCells()
      flowDir = parsed.dir
      flowExtras = parsed.extras
      dirSelect.value = parsed.dir
      let needsLayout = false
      for (const node of parsed.nodes) {
        const hasPos = Number.isFinite(node.x) && Number.isFinite(node.y)
        if (!hasPos) needsLayout = true
        graph.addNode(
          nodeMetadata(node, hasPos ? (node.x as number) : 0, hasPos ? (node.y as number) : 0) as never,
        )
      }
      const ids = new Set(parsed.nodes.map((node) => node.id))
      for (const edge of parsed.edges) {
        if (!ids.has(edge.from) || !ids.has(edge.to)) continue
        graph.addEdge(edgeMetadata(edge) as never)
      }
      try {
        graph.cleanHistory()
      } catch {
        /* history plugin missing — ignore */
      }
      if (needsLayout) {
        void autoLayout(true)
      } else {
        graph.centerContent()
      }
    } finally {
      building = false
    }
  }

  async function autoLayout(quiet: boolean): Promise<void> {
    if (!graph || mode !== 'canvas') return
    const nodes = graph.getNodes()
    if (!nodes.length) return
    try {
      const mod = (await import('elkjs/lib/elk.bundled.js')) as unknown as {
        default?: new () => {
          layout(spec: Record<string, unknown>): Promise<{
            children?: Array<{ id: string; x?: number; y?: number }>
          }>
        }
      }
      const ELK = mod.default
      if (!ELK) throw new Error('elkjs 默认导出缺失')
      const elk = new ELK()
      const layout = await elk.layout({
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'mrtree',
          'elk.direction': ELK_DIR[flowDir] ?? 'DOWN',
          'elk.spacing.nodeNode': 46,
          'elk.layered.spacing.nodeNodeBetweenLayers': 56,
        },
        children: nodes.map((node) => {
          const size = node.getSize()
          return { id: node.id, width: size.width, height: size.height }
        }),
        edges: graph.getEdges().map((edge, index) => ({
          id: `e${index}`,
          sources: [edge.getSourceCellId()],
          targets: [edge.getTargetCellId()],
        })),
      })
      for (const child of layout.children ?? []) {
        if (!Number.isFinite(child.x) || !Number.isFinite(child.y)) continue
        const node = nodes.find((candidate) => candidate.id === child.id)
        node?.position(child.x as number, child.y as number)
      }
      graph.centerContent()
      if (!quiet) setStatus('已自动布局', 'ok')
    } catch (error) {
      console.warn('[markup] elkjs 布局失败，回退网格排布', error)
      gridLayout(nodes)
      graph.centerContent()
      if (!quiet) setStatus('自动布局引擎不可用，已使用网格排布', 'bad')
    }
  }

  function gridLayout(nodes: X6Node[]): void {
    const count = nodes.length
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
    nodes.forEach((node, index) => {
      const size = node.getSize()
      const col = index % cols
      const row = Math.floor(index / cols)
      node.position(40 + col * (size.width + 60), 40 + row * (size.height + 56))
    })
  }

  function createGraph(x6: typeof import('@antv/x6')): X6Graph {
    const instance = new x6.Graph({
      container: canvasHost,
      background: { color: 'transparent' },
      grid: { size: 10, visible: true, type: 'dot', args: { color: 'rgba(128,136,152,0.35)' } },
      panning: { enabled: true },
      mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.4, maxScale: 2.5 },
      translating: { restrict: true },
      connecting: { allowBlank: false, allowNode: false, allowEdge: false },
    })
    instance.use(new x6.Selection({ multiple: false, rubberband: false }))
    instance.use(new x6.Snapline())
    instance.use(new x6.History())
    instance.use(new x6.Transform({ rotating: false, resizing: { enabled: true, minWidth: 40, minHeight: 24 } }))

    instance.on('node:click', ({ node }) => {
      if (building) return
      if (connectMode) {
        handleConnectClick(node)
        return
      }
      showNodeProps(node)
    })
    instance.on('edge:click', ({ edge }) => {
      if (building) return
      if (connectMode) return
      showEdgeProps(edge)
    })
    instance.on('blank:click', () => {
      if (building) return
      if (connectMode) cancelConnect()
      showProps(null)
    })
    return instance
  }

  function teardownX6(): void {
    if (graph) {
      try {
        graph.dispose()
      } catch {
        /* ignore */
      }
      graph = null
    }
    cancelConnectSilently()
    showProps(null)
  }

  function destroyVisimer(): void {
    if (visToolOff) {
      try {
        visToolOff()
      } catch {
        /* ignore */
      }
      visToolOff = null
    }
    if (visView) {
      try {
        visView.destroy()
      } catch {
        /* ignore */
      }
      try {
        canvasHost.replaceChildren()
      } catch {
        /* ignore */
      }
    }
    visView = null
    visEngine = null
    visKind = 'other'
  }

  function fallbackToSource(message: string): void {
    teardownX6()
    destroyVisimer()
    setMode('source')
    setStatus(message, 'bad')
  }

  function cancelConnectSilently(): void {
    connectMode = false
    pendingSource = null
    connectBtn.classList.remove('is-active')
  }

  async function enterVisimerCanvas(code: string, vis: VisModules): Promise<boolean> {
    teardownX6()
    try {
      const info = vis.core.detectDiagramType(mermaidHeader(code))
      visKind = info?.id === 'flowchart' ? 'flow' : info?.id === 'sequence' ? 'seq' : 'other'
      const mermaidMod = await import('mermaid')
      if (!visEngine || !visView) {
        visEngine = new vis.core.MermaidWysiwygEditor({ code })
        visView = new vis.dom.MermaidCanvasView({
          editor: visEngine,
          container: canvasHost,
          mermaid: mermaidMod.default,
          mermaidConfig: { theme: 'neutral' },
          panZoom: true,
        })
        visToolOff = visView.on('toolChange', (tool) => {
          connectBtn.classList.toggle('is-active', tool === 'connect')
        })
      } else {
        visEngine.setCode(code)
        visView.setTool('select')
      }
      setMode('canvas')
      updateModeButtons()
      await visView.render()
      if (visView.renderError) throw new Error(visView.renderError)
      setStatus('可视化画布就绪：点击选中，双击改名，连线按钮后拖拽连线', 'ok')
      return true
    } catch (error) {
      console.warn('[markup] Visimer 画布初始化失败', error)
      destroyVisimer()
      fallbackToSource('可视化画布初始化失败，已切换到源码模式')
      return false
    }
  }

  async function enterCanvas(rebuildFromSource: boolean): Promise<boolean> {
    if (mode === 'canvas' && !rebuildFromSource && (graph || visView)) return true
    const code = sourceArea.value
    const parsed = parseFlowchart(code)
    if (parsed.ok) {
      destroyVisimer()
      const x6 = await ensureX6()
      if (!x6) {
        fallbackToSource('可视化画布组件加载失败，已切换到源码模式')
        return false
      }
      if (!graph) {
        setMode('canvas')
        try {
          graph = createGraph(x6)
        } catch (error) {
          console.warn('[markup] X6 初始化失败', error)
          fallbackToSource('可视化画布初始化失败，已切换到源码模式')
          return false
        }
      } else {
        setMode('canvas')
      }
      try {
        buildCells(parsed.graph)
      } catch (error) {
        console.warn('[markup] 画布构建失败', error)
        fallbackToSource('画布构建失败，已切换到源码模式')
        return false
      }
      setStatus('画布就绪：拖动节点调整位置，选中可编辑属性', 'ok')
      return true
    }
    // Not a plain flowchart (sequence/class/ER/subgraph…): try the Visimer canvas.
    const vis = await ensureVisimer()
    if (vis && editableDiagramType(vis, code)) {
      return enterVisimerCanvas(code, vis)
    }
    setMode('source')
    setStatus(
      parsed.reason === 'not-flowchart'
        ? '这不是 mermaid 流程图（flowchart/graph），已停留在源码模式'
        : '检测到暂不支持的流程图语法（如 sequence/subgraph），已停留在源码模式',
      'bad',
    )
    return false
  }

  function switchToSource(): void {
    if (mode === 'canvas') {
      const code = currentCode()
      sourceArea.value = code
      cancelConnectSilently()
      showProps(null)
    }
    setMode('source')
    setStatus('源码模式：直接编辑 mermaid 流程图语法')
    sourceArea.focus()
  }

  async function confirm(): Promise<void> {
    const opts = openState
    if (mode === 'canvas' && !graph && !visView) {
      setStatus('画布尚未就绪，请稍候或切换到源码模式', 'bad')
      return
    }
    const code = currentCode().trim()
    if (!code) {
      setStatus('流程图内容为空', 'bad')
      return
    }
    if (mode === 'source') {
      const flowOk = parseFlowchart(code).ok
      if (!flowOk) {
        const vis = await ensureVisimer()
        const typeInfo = vis ? editableDiagramType(vis, code) : null
        if (!typeInfo) {
          setStatus('内容不是有效的可编辑 mermaid 图（flowchart/sequence/class/…）', 'bad')
          return
        }
      }
    }
    close()
    opts?.onConfirm(code)
  }

  function close(): void {
    if (root.hidden) return
    const opts = openState
    openState = null
    root.hidden = true
    cancelConnectSilently()
    showProps(null)
    teardownX6()
    destroyVisimer()
    sourceArea.value = ''
    setMode('source')
    opts?.onCancel?.()
  }

  function open(options?: DiagramEditorOpenOptions): void {
    if (!root.hidden) close()
    openState = options ?? null
    titleEl.textContent = options?.title ?? '编辑流程图'
    confirmBtn.textContent = '应用'
    const code = (options?.code ?? '').trim() || FLOW_TEMPLATE
    sourceArea.value = code
    flowDir = 'TD'
    flowExtras = []
    dirSelect.value = 'TD'
    root.hidden = false
    showProps(null)
    cancelConnectSilently()
    setMode('source')
    setStatus('正在初始化画布…')
    void enterCanvas(true)
  }

  root.addEventListener('click', (event) => {
    if (event.target === root) close()
  })
  // Visimer handles Escape on its container (exit connect tool / clear
  // selection) but lets the event bubble — without this capture gate the
  // dialog would close on top of it. Capture runs before its bubble listener.
  canvasHost.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !visEngine || !visView) return
      if (visView.currentTool !== 'connect') return
      event.stopPropagation()
      event.preventDefault()
      cancelConnect()
    },
    true,
  )
  root.addEventListener('keydown', (event) => {
    if (root.hidden) return
    if (event.key === 'Escape') {
      if (connectMode) {
        event.stopPropagation()
        event.preventDefault()
        cancelConnect()
        return
      }
      event.stopPropagation()
      close()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void confirm()
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && mode === 'canvas' && graph) {
      const active = document.activeElement
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          (active as HTMLElement).isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      deleteSelection()
    }
  })

  updateModeButtons()
  setMode('source')

  return {
    el: root,
    open,
    close,
    isOpen: () => !root.hidden,
  }
}
