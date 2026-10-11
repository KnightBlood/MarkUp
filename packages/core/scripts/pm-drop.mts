/**
 * Smoke: 拖入文件 — what a dropped file becomes.
 *
 * The ordering *is* the decision, and it is the part that breaks silently: an
 * image test placed first would swallow a `.md` that reports an image MIME type,
 * and a link fallback placed first would swallow everything.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { classifyDroppedFile, isDocumentName } = await import('../src/dropTargets')

// ---- documents -------------------------------------------------------------
assert(isDocumentName('note.md'), 'md is a document')
assert(isDocumentName('NOTE.MARKDOWN'), 'extension match is case-insensitive')
assert(isDocumentName('a.mdown') && isDocumentName('a.mkd'), 'the other markdown spellings')
assert(isDocumentName('notes.txt'), 'txt opens as a document, like Typora')
assert(!isDocumentName('note.mdx'), 'mdx is not claimed')
assert(!isDocumentName('image.png'), 'a png is not a document')
assert(classifyDroppedFile({ name: 'note.md', type: '' }) === 'document', 'md → open')
assert(
  classifyDroppedFile({ name: 'note.md', type: 'text/markdown' }) === 'document',
  'a text/markdown md still opens',
)
// A document wins over the image test: `diagram.png.md` is a document.
assert(
  classifyDroppedFile({ name: 'diagram.png.md', type: 'image/png' }) === 'document',
  'the document test runs first',
)

// ---- images ----------------------------------------------------------------
assert(classifyDroppedFile({ name: 'shot.png', type: 'image/png' }) === 'image', 'png → image')
assert(
  classifyDroppedFile({ name: 'shot.avif', type: '' }) === 'image',
  'the extension fallback still applies',
)
assert(
  classifyDroppedFile({ name: 'shot.bin', type: 'application/octet-stream' }) === 'link',
  'octet-stream without an image extension is not an image',
)

// ---- everything else -------------------------------------------------------
assert(classifyDroppedFile({ name: 'report.pdf', type: 'application/pdf' }) === 'link', 'pdf → link')
assert(classifyDroppedFile({ name: 'archive.zip', type: '' }) === 'link', 'zip → link')
assert(classifyDroppedFile({ name: '', type: '' }) === 'link', 'a nameless file is a link')

console.log('SMOKE CORE DROP OK: document beats image beats link + case-insensitive extensions')
