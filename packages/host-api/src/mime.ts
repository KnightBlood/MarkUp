const EMBED_MIME: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
}

/**
 * MIME type for embed assets (3D models / video) resolved by file extension —
 * used by `fs.readBase64` to build a `data:` URL. Unknown extensions fall
 * back to `application/octet-stream`.
 */
export function embedMimeForPath(path: string): string {
  const match = /\.[a-z0-9]+$/i.exec(path)
  const mime = match ? EMBED_MIME[match[0].toLowerCase()] : undefined
  return mime ?? 'application/octet-stream'
}
