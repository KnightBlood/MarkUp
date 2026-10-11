import type { HostAPI } from './types'

declare global {
  interface Window {
    __HOST__?: HostAPI
  }
}

export * from './types'
export * from './verify'
export * from './mime'

// A runtime value cannot rely on `export *`: the CJS interop some runtimes use
// (tsx under `node --import tsx`, which each package's smoke runs on) analyses
// re-exports statically and does not follow a star, so the named export would
// come back undefined. Named re-exports are the ones it can see. Types are
// unaffected — they are erased before then.
export { IMAGE_COPY_MODES } from './types'

export function setHost(host: HostAPI): void {
  // contextBridge.exposeInMainWorld (Electron preload) defines a read-only
  // window.__HOST__; only assign when the host was not injected by the shell.
  if (window.__HOST__ === undefined) {
    window.__HOST__ = host
  }
}

export function getHost(): HostAPI {
  const host = window.__HOST__
  if (!host) {
    throw new Error('HostAPI 未设置：请在 boot 阶段调用 setHost()')
  }
  return host
}