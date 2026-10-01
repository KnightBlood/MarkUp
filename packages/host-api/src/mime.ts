const EMBED_MIME: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.f4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.qt': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.divx': 'video/x-msvideo',
  '.xvid': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.asf': 'video/x-ms-asf',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
  '.rm': 'application/vnd.rn-realmedia',
  '.rmvb': 'application/vnd.rn-realmedia-vbr',
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
