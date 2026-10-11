/**
 * Save-time text normalisation — Typora's 「默认换行符」 and 「保存时在文末添加空行」.
 *
 * Applied **on the way out only**: the buffer keeps whatever the editor is
 * holding, so picking a different line ending never rewrites the text under the
 * caret (which would move the selection in every view). The file on disk is the
 * normalised one, which is what those settings are actually about.
 */

export type LineEnding = 'preserve' | 'lf' | 'crlf'

export interface SaveTextOptions {
  lineEnding: LineEnding
  /** Add a trailing newline when the document does not end with one. */
  finalNewline: boolean
}

export function normalizeForSave(markdown: string, options: SaveTextOptions): string {
  // An empty document stays empty: adding a newline would turn "no file content"
  // into "a file containing one blank line".
  if (markdown.length === 0) return markdown

  let text = markdown
  if (options.lineEnding !== 'preserve') {
    // Collapse both spellings first, then apply the chosen one — otherwise a
    // document with mixed endings keeps whichever each line happened to have,
    // and the setting would look like it only half worked.
    text = text.replace(/\r\n?/g, '\n')
    if (options.lineEnding === 'crlf') text = text.replace(/\n/g, '\r\n')
  }

  if (options.finalNewline && !/[\r\n]$/.test(text)) {
    // Terminate in the chosen style, or the last line would be the one line
    // whose ending disagrees with the other ninety-nine.
    text += options.lineEnding === 'crlf' ? '\r\n' : '\n'
  }
  return text
}
