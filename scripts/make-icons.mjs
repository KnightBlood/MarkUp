/**
 * Markup 图标生成：把浏览器光栅化的母版 PNG 重采样成各尺寸 PNG，并合成 Windows .ico。
 *
 * 零依赖：只用到 node:zlib（PNG 的 IDAT 就是 zlib 流）+ 自写 CRC32。
 *
 *   node scripts/make-icons.mjs <master.png> <outDir>
 *
 * 说明：母版由 `artifacts/brand/render.html?s=1024` 截图得到（浏览器渲染 SVG），
 * 这里做面积平均（box filter）重采样 —— 对扁平矢量图形足够干净，且不引入 sharp/canvas 依赖。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

const SIZES = [512, 256, 128, 64, 48, 32, 16]
const ICO_SIZES = [16, 32, 48, 64, 128, 256]

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/** 解码 8bit RGB/RGBA 非隔行 PNG → { width, height, channels, data(RGBA) } */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 6
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const bitDepth = data.readUInt8(8)
      colorType = data.readUInt8(9)
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
      if (data.readUInt8(12) !== 0) throw new Error('interlaced PNG unsupported')
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error(`unsupported color type ${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  let pos = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]
    pos += 1
    const line = Buffer.from(raw.subarray(pos, pos + stride))
    pos += stride
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      const x = line[i]
      let value = x
      if (filter === 1) value = x + a
      else if (filter === 2) value = x + b
      else if (filter === 3) value = x + ((a + b) >> 1)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      line[i] = value & 0xff
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * channels
      const dst = (y * width + x) * 4
      out[dst] = line[src]
      out[dst + 1] = line[src + 1]
      out[dst + 2] = line[src + 2]
      out[dst + 3] = channels === 4 ? line[src + 3] : 255
    }
    prev = line
  }
  return { width, height, data: out }
}

/** 色键抠底：把接近 key 的像素变成透明，边缘按颜色距离反解 alpha 并去除底色污染 */
function chromaKey(image, keyHex) {
  const key = [
    Number.parseInt(keyHex.slice(0, 2), 16),
    Number.parseInt(keyHex.slice(2, 4), 16),
    Number.parseInt(keyHex.slice(4, 6), 16),
  ]
  const { data } = image
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const distance = Math.max(Math.abs(r - key[0]), Math.abs(g - key[1]), Math.abs(b - key[2]))
    if (distance === 0) {
      data[i + 3] = 0
      continue
    }
    // 边缘像素是「前景 + 底色」的混合：用与底色的差异度近似 alpha，再反混合还原前景色。
    const alpha = Math.min(1, distance / 96)
    if (alpha >= 1) continue
    const inv = alpha
    data[i] = Math.max(0, Math.min(255, Math.round((r - key[0] * (1 - inv)) / inv)))
    data[i + 1] = Math.max(0, Math.min(255, Math.round((g - key[1] * (1 - inv)) / inv)))
    data[i + 2] = Math.max(0, Math.min(255, Math.round((b - key[2] * (1 - inv)) / inv)))
    data[i + 3] = Math.round(alpha * 255)
  }
  return image
}

/** 裁掉左上角 cropSide×cropSide（母版截图里图标正好占这个方块） */
function crop(image, side) {
  const { width, data } = image
  const size = Math.min(side, width, image.height)
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    data.copy(out, y * size * 4, y * width * 4, y * width * 4 + size * 4)
  }
  return { width: size, height: size, data: out }
}

/** 面积平均重采样（含边缘分数权重），保持 alpha */
function resize(src, target) {
  const { width: sw, height: sh, data } = src
  const scale = sw / target
  const out = Buffer.alloc(target * target * 4)
  for (let y = 0; y < target; y += 1) {
    const y0 = y * scale
    const y1 = Math.min(sh, (y + 1) * scale)
    const iy0 = Math.floor(y0)
    const iy1 = Math.ceil(y1)
    for (let x = 0; x < target; x += 1) {
      const x0 = x * scale
      const x1 = Math.min(sw, (x + 1) * scale)
      const ix0 = Math.floor(x0)
      const ix1 = Math.ceil(x1)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let weight = 0
      for (let sy = iy0; sy < iy1; sy += 1) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy)
        if (wy <= 0) continue
        for (let sx = ix0; sx < ix1; sx += 1) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx)
          if (wx <= 0) continue
          const w = wx * wy
          const at = (sy * sw + sx) * 4
          r += data[at] * w
          g += data[at + 1] * w
          b += data[at + 2] * w
          a += data[at + 3] * w
          weight += w
        }
      }
      const at = (y * target + x) * 4
      out[at] = Math.round(r / weight)
      out[at + 1] = Math.round(g / weight)
      out[at + 2] = Math.round(b / weight)
      out[at + 3] = Math.round(a / weight)
    }
  }
  return { width: target, height: target, data: out }
}

/** RGBA → PNG（filter 0，无隔行） */
function encodePng(image) {
  const { width, height, data } = image
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(6, 9)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 多尺寸 PNG 打包成 ICO（Vista+ 直接内嵌 PNG） */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = 6 + 16 * entries.length
  const directory = []
  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    directory.push(entry)
  }
  return Buffer.concat([header, ...directory, ...entries.map((e) => e.png)])
}

const [masterPath, outDirArg, cropArg, keyArg, prefixArg] = process.argv.slice(2)
if (!masterPath) {
  console.error(
    'usage: node scripts/make-icons.mjs <master.png> <outDir> [cropSide] [keyHex] [prefix]',
  )
  process.exit(1)
}
const outDir = resolve(outDirArg ?? join(masterPath, '..'))
const prefix = prefixArg && prefixArg !== '-' ? `${prefixArg}-` : 'icon-'
mkdirSync(outDir, { recursive: true })

let master = decodePng(readFileSync(resolve(masterPath)))
console.log(`master: ${master.width}x${master.height}`)
if (cropArg) {
  master = crop(master, Number(cropArg))
  console.log(`cropped: ${master.width}x${master.height}`)
}
if (keyArg && keyArg !== '-') {
  master = chromaKey(master, keyArg)
  console.log(`chroma key #${keyArg}`)
}

const written = new Map()
for (const size of SIZES) {
  const png = encodePng(resize(master, size))
  writeFileSync(join(outDir, `${prefix}${size}.png`), png)
  written.set(size, png)
  console.log(`${prefix}${size}.png  ${(png.length / 1024).toFixed(1)} KB`)
}

const ico = buildIco(
  ICO_SIZES.filter((size) => written.has(size)).map((size) => ({
    size,
    png: written.get(size),
  })),
)
const icoName = `${prefix.replace(/-$/, '')}.ico`
writeFileSync(join(outDir, icoName), ico)
console.log(`${icoName}  ${(ico.length / 1024).toFixed(1)} KB (${ICO_SIZES.join('/')})`)
