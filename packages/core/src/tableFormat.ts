/**
 * 格式化表格源码 — Typora's 「格式化表格源码」.
 *
 * Marks a table's columns line up in the *source*. The subtlety is that
 * alignment is a property of the rendered text, not of the string length:
 * a CJK character occupies two cells, so padding by `.length` produces a table
 * that looks ragged in exactly the documents this feature exists for.
 */

import type { TextEdit, TextRange } from './textFormat'

/** Rows of raw cell text, plus which row is the delimiter. */
interface Table {
  /** Absolute range covering the whole table block. */
  from: number
  to: number
  header: string[]
  delimiter: string[]
  body: string[][]
}

/** A `|---|:--:|---:|` cell. */
const DELIMITER_CELL = /^:?-+:?$/

/**
 * How many monospace cells `text` occupies: two per CJK/full-width character,
 * one otherwise. Combining marks take none.
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0x200d || (code >= 0x0300 && code <= 0x036f)) continue
    width += isWide(code) ? 2 : 1
  }
  return width
}

/** East Asian Wide / Fullwidth, plus the emoji blocks, approximated. */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

/** Split one row into cells, honouring `\|` and the optional outer pipes. */
export function splitRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!
    if (char === '\\' && text[i + 1] === '|') {
      current += '\\|'
      i += 1
      continue
    }
    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

/** The table block containing `offset`, or null when there is not one. */
function tableAt(markdown: string, offset: number): Table | null {
  const lines = markdown.split('\n')
  // Line starts, so a rebuilt block can be spliced back by absolute offset.
  const starts: number[] = []
  let at = 0
  for (const line of lines) {
    starts.push(at)
    at += line.length + 1
  }
  const isRow = (line: string): boolean => line.trim().startsWith('|') || line.includes('|')
  let index = lines.findIndex((_line, i) => offset >= starts[i]! && offset <= starts[i]! + lines[i]!.length)
  if (index < 0) index = lines.length - 1
  if (!isRow(lines[index]!)) return null
  let first = index
  while (first > 0 && isRow(lines[first - 1]!)) first -= 1
  let last = index
  while (last + 1 < lines.length && isRow(lines[last + 1]!)) last += 1
  // A table needs a header and a delimiter row to be a table at all.
  if (last - first < 1) return null
  const header = splitRow(lines[first]!)
  const delimiter = splitRow(lines[first + 1]!)
  if (!delimiter.every((cell) => DELIMITER_CELL.test(cell))) return null
  const body = lines.slice(first + 2, last + 1).map(splitRow)
  return {
    from: starts[first]!,
    to: starts[last]! + lines[last]!.length,
    header, 
    delimiter,
    body,
  }
}

/** Pad `text` to `width` display cells, appending spaces. */
const pad = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - displayWidth(text)))

/** Rebuild a delimiter cell, keeping its alignment and reaching `width` cells. */
function delimiterCell(cell: string, width: number): string {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  // A delimiter cell needs at least one dash on each side of its colons.
  const dashes = Math.max(3, width - (left ? 1 : 0) - (right ? 1 : 0))
  return `${left ? ':' : ''}${'-'.repeat(dashes)}${right ? ':' : ''}`
}

/** `| a | b |` with every column padded to its widest cell. */
export function formatTableSource(markdown: string, range: TextRange): TextEdit | null {
  const table = tableAt(markdown, range.from)
  if (!table) return null
  const rows = [table.header, table.delimiter, ...table.body]
  const columns = Math.max(...rows.map((row) => row.length))
  const widths: number[] = []
  for (let c = 0; c < columns; c += 1) {
    // The delimiter row does not participate: its width follows the content.
    const cells = [table.header[c] ?? '', ...table.body.map((row) => row[c] ?? '')]
    widths.push(Math.max(...cells.map(displayWidth)))
  }
  const render = (row: string[], isDelimiter: boolean): string =>
    `| ${widths
      .map((width, c) => {
        const cell = row[c] ?? ''
        return isDelimiter ? delimiterCell(cell, width) : pad(cell, width)
      })
      .join(' | ')} |`
  const text = [
    render(table.header, false),
    render(table.delimiter, true),
    ...table.body.map((row) => render(row, false)),
  ].join('\n')
  // Nothing to do when it is already formatted — a no-op must not dirty the doc.
  if (text === markdown.slice(table.from, table.to)) return null
  return { range: { from: table.from, to: table.to }, text }
}
