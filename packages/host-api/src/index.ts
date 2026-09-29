import type { HostAPI } from './types'

declare global {
  interface Window {
    __HOST__?: HostAPI
  }
}

export * from './types'
export * from './verify'
export * from './mime'

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