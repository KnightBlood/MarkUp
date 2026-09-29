function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { parseLineLink } = await import('../src/mdLinks')

const link = parseLineLink('see [Docs](https://example.com/a) end', 10)
assert(link !== null, 'finds link')
assert(link.kind === 'link', 'link kind')
assert(link.text === 'Docs', `label: ${link.text}`)
assert(link.url === 'https://example.com/a', `url: ${link.url}`)
assert(link.start === 4, `start: ${link.start}`)
assert(link.end === 4 + '[Docs](https://example.com/a)'.length, `end: ${link.end}`)

const image = parseLineLink('![alt](https://img.test/x.png "t")', 2)
assert(image !== null, 'finds image')
assert(image.kind === 'image', 'image kind')
assert(image.url === 'https://img.test/x.png', `image url: ${image.url}`)

const angled = parseLineLink('[t](<https://ex.com/p q>)')
assert(angled?.url === 'https://ex.com/p q', `angled with space: ${angled?.url}`)

const angledSimple = parseLineLink('[t](<https://ex.com/path>)')
assert(angledSimple?.url === 'https://ex.com/path', `angled simple: ${angledSimple?.url}`)

const titled = parseLineLink('[t](https://ex.com "title")')
assert(titled?.url === 'https://ex.com', `titled url: ${titled?.url}`)

const multi = parseLineLink('[a](https://a.test) and [b](https://b.test)', 30)
assert(multi?.text === 'b', `column prefers b: ${multi?.text}`)

const none = parseLineLink('plain text')
assert(none === null, 'no link')

const col0 = parseLineLink('[a](https://a.test) [b](https://b.test)', 0)
assert(col0?.text === 'a', 'column 0 prefers a')

console.log('SMOKE UI MD LINKS OK: link/image/angled/titled/column/none')
