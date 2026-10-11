/**
 * 智能输入 — 「智能引号」「智能破折号」「使用成对的符号」.
 *
 * Pure on purpose. Three views need these rules and each has its own input hook
 * (ProseMirror's `handleTextInput`, CodeMirror's `inputHandler`, a textarea's
 * `beforeinput`), so the rules live here once and each view only has to answer
 * "what is before the caret, what is after it, and what was typed".
 *
 * The contract is a single replacement plus a caret offset, because every rule
 * ends up being one of:
 *   - insert something other than what was typed (`"` → `“`),
 *   - insert more than what was typed (`(` → `()`),
 *   - delete what came before (`--` → `—`),
 *   - do nothing and step over a closer we inserted earlier (`)` before `)`).
 */

import { emojiForShortcode, shortcodeBefore } from './emoji'

export interface SmartInputOptions {  /** `"` → `“`/`”`, `'` → `‘`/`’`. */
  smartQuotes: boolean
  /** `--` → `—`, `...` → `…`. */
  smartDashes: boolean
  /** Typing an opener also inserts its closer, caret inside. */
  pairedSymbols: boolean
  /** Emoji 自动补全 — `:name:` becomes the emoji on the closing colon. */
  emoji: boolean
}

/** The default: every rule off, so nothing rewrites what the user types. */
export const SMART_INPUT_OFF: SmartInputOptions = {
  smartQuotes: false,
  smartDashes: false,
  pairedSymbols: false,
  emoji: false,
}

export interface TypingContext {
  /**
   * The text immediately before the insertion point ('' at the start). A short
   * *slice*, not one character: the ellipsis rule has to see the two dots
   * already there.
   */
  before: string
  /** The text immediately after the insertion point ('' at the end). */
  after: string
  /** What was typed. */
  text: string
  /** True when a selection is being replaced. */
  hasSelection: boolean
}

export interface SmartInputResult {
  /** Insert this in place of `text`. */
  text: string
  /** How many characters before the caret to remove along with it. */
  deleteBefore: number
  /**
   * Where the caret goes, relative to the insertion point — 0 would leave it
   * before what was inserted, `text.length` after it.
   */
  caretOffset: number
  /**
   * Set when the typed character should *wrap* the current selection instead.
   * The caller holds the selected text; the pair is here because only this
   * module knows whether the quote curls.
   */
  wrap?: { open: string; close: string }
}

/** Openers that get a matching closer. */
const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '（': '）',
  '【': '】',
  '《': '》',
}

/** Closers we must be able to step over rather than double up. */
const CLOSERS = new Set(Object.values(PAIRS))

const STRAIGHT_QUOTES = new Set(['"', "'"])
const BACKTICK = '`'

/** Curly forms, keyed by the straight quote that produces them. */
const CURLY: Record<string, { open: string; close: string }> = {
  '"': { open: '“', close: '”' },
  "'": { open: '‘', close: '’' },
}

/** A quote after one of these is opening; after anything else it is closing. */
const OPEN_CONTEXT = /[\s([{（【《“‘‘-]$/

const NONE: SmartInputResult = { text: '', deleteBefore: 0, caretOffset: 0 }

export function smartInput(
  context: TypingContext,
  options: SmartInputOptions,
): SmartInputResult {
  const { before, after, text, hasSelection } = context

  // Step over a closer we inserted earlier: typing it right before itself should
  // move past, not produce `))`. This is what makes auto-pairing usable rather
  // than something the user has to backspace through.
  if (text.length === 1 && after.startsWith(text) && (CLOSERS.has(text) || text === '`')) {
    return { ...NONE, caretOffset: 1 }
  }

  // Emoji 自动补全: the closing colon of `:name:` is what triggers it, so the rule
  // runs on `:` and looks *back* for the shortcode. Checked before the pair rules
  // because `:` is not a pair and an unknown shortcode must fall through to a
  // literal colon rather than being eaten.
  if (options.emoji && text === ':') {
    const name = shortcodeBefore(before)
    const emoji = name ? emojiForShortcode(name) : null
    if (name && emoji) {
      // Remove the colon that opened the shortcode along with its name; the colon
      // currently being typed is replaced by the emoji itself.
      return { ...NONE, text: emoji, deleteBefore: name.length + 1, caretOffset: emoji.length }
    }
  }

  // `--` → `—`, `...` → `…`. Checked before the pair rules: neither character is
  // a pair, but a `-` inside `<!--` must not be touched and this is the guard.
  if (options.smartDashes && text.length === 1) {
    if (text === '-' && before.endsWith('-')) {
      return { ...NONE, text: '—', deleteBefore: 1, caretOffset: 1 }
    }
    if (text === '.' && before.endsWith('..')) {
      return { ...NONE, text: '…', deleteBefore: 2, caretOffset: 1 }
    }
  }

  const quote = STRAIGHT_QUOTES.has(text) || text === BACKTICK
  const curly = options.smartQuotes && STRAIGHT_QUOTES.has(text) ? CURLY[text] : undefined

  if (quote) {
    // With a selection, the caller wraps it — it holds the text, this does not.
    // Only when a rule asked for it, though: wrapping is a change the user opted
    // into, not something that happens with every option off.
    const opening = before.length === 0 || OPEN_CONTEXT.test(before)
    const open = curly?.open ?? text
    const close = curly?.close ?? text
    if (hasSelection) {
      if (!options.pairedSymbols && !options.smartQuotes) {
        return { text, deleteBefore: 0, caretOffset: text.length }
      }
      // A closing position still wraps with the opening pair — the user selected
      // text and pressed a quote, which can only mean "quote this".
      return { ...NONE, wrap: { open, close } }
    }
    if (!opening) {
      // A closing position never pairs. Pairing a closer is exactly how `a""`
      // gets produced when the user types both quotes by hand.
      return { ...NONE, text: close, caretOffset: close.length }
    }
    if (options.pairedSymbols) {
      return { ...NONE, text: open + close, caretOffset: open.length }
    }
    return { ...NONE, text: open, caretOffset: open.length }
  }

  if (options.pairedSymbols && PAIRS[text]) {
    return { ...NONE, text: text + PAIRS[text], caretOffset: text.length }
  }

  // No rule applies: insert exactly what was typed and leave the caret after it.
  // Returning an empty `text` here would swallow the keystroke.
  return { text, deleteBefore: 0, caretOffset: text.length }
}

/** The concrete edit a view should apply at `range`. */
export interface SmartInputEdit {
  /** Start of the range to replace — may reach *before* the insertion point. */
  from: number
  to: number
  insert: string
  /** Absolute caret offset once the edit is applied. */
  caret: number
}

/**
 * Turn a result into a range edit.
 *
 * Shared rather than repeated in each view: the `deleteBefore` offset (which
 * reaches back over `--` → `—`) and the wrap case (which splices the selected
 * text inside the pair) are exactly the arithmetic a view is most likely to get
 * subtly wrong, and getting it wrong corrupts the document rather than throwing.
 */
export function smartInputEdit(
  result: SmartInputResult,
  range: { from: number; to: number },
  selected: string,
): SmartInputEdit {
  if (result.wrap) {
    return {
      from: range.from,
      to: range.to,
      insert: `${result.wrap.open}${selected}${result.wrap.close}`,
      caret: range.from + result.wrap.open.length + selected.length + result.wrap.close.length,
    }
  }
  const from = range.from - result.deleteBefore
  return {
    from,
    to: range.to,
    insert: result.text,
    caret: from + result.caretOffset,
  }
}
