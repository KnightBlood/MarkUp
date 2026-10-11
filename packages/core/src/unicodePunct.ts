/**
 * 解析时识别 Unicode 标点 — read Unicode punctuation as its ASCII equivalent
 * while parsing.
 *
 * The document on disk is untouched; only the string handed to the parser is
 * rewritten. This matters in two situations Typora names:
 *
 *   - **Smart punctuation turned the syntax itself into Unicode.** `「title」`
 *     after `--` conversion is no longer a link title, and `》` is no longer a
 *     blockquote — the markdown stopped being markdown.
 *   - **An IME cannot produce ASCII punctuation at all.** A Chinese keyboard
 *     gives `＃`, `＊`, `－` for `#`, `*`, `-`.
 *
 * Because it rewrites the *input*, the rendered output shows the ASCII form —
 * that is the point, not a side effect to be worked around. Which is also why it
 * is opt-in.
 */

/**
 * Unicode characters whose ASCII counterpart carries markdown syntax.
 *
 * Deliberately limited to punctuation that *is* markdown somewhere: a full-width
 * comma or a Chinese full stop has no ASCII meaning to map onto, and rewriting
 * ordinary prose punctuation would change the text rather than help it parse.
 */
export const PUNCTUATION_REMAP: Readonly<Record<string, string>> = {
  // Full-width forms of the ASCII punctuation markdown is built from.
  '＃': '#',
  '＊': '*',
  '－': '-',
  '＿': '_',
  '＋': '+',
  '＝': '=',
  '｜': '|',
  '～': '~',
  '！': '!',
  '＞': '>',
  '＜': '<',
  '：': ':',
  '（': '(',
  '）': ')',
  '［': '[',
  '］': ']',
  // Deliberately excluded: `，` and `．`. A full-width comma or full stop is
  // ordinary CJK prose with no markdown role, so rewriting it would change what
  // the document says rather than help it parse.
  // CJK brackets that stand in for a blockquote or a quoted title.
  '》': '>',
  '「': '"',
  '」': '"',
  '『': '"',
  '』': '"',
  // Curly and guillemet quotes, which smart punctuation produces from `"`.
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '«': '"',
  '»': '"',
}

/**
 * Rewrite the Unicode alternatives of markdown syntax as ASCII.
 *
 * One pass rather than one `replace` per character: the escape branch has to see
 * the backslash *and* the character it escapes, which a set-based replace cannot
 * distinguish from a bare character.
 *
 * Escaped characters are left alone — `\》` is an explicit request for a literal
 * `》`, and remapping it would override the one way a user has to opt out.
 */
export function remapUnicodePunctuation(markdown: string): string {
  return markdown.replace(/(\\[\s\S])|([\s\S])/g, (_whole, escaped: string, char: string) =>
    escaped ? escaped : (PUNCTUATION_REMAP[char] ?? char),
  )
}
