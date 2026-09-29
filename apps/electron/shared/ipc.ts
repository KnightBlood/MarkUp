import type { MessageOptions } from '@markup/host-api'

export const HOST_EVENT_CHANNEL = 'host:event'

/**
 * Preload → renderer request: show the shared in-app message dialog.
 * `contextBridge` exposes `window.__HOST__` read-only, so `dialog.message`
 * cannot be patched renderer-side — preload relays the request over a DOM
 * event (document is shared across the context bridge) and waits for a
 * per-request reply event carrying `{ button }`.
 */
export const HOST_MESSAGE_REQUEST = 'markup:host-message-request'

export interface HostMessageRequest {
  /** Per-request reply event name; the renderer dispatches the result on it. */
  reply: string
  options: MessageOptions
}

export const IPC_CHANNELS = {
  fsRead: 'markup:fs:read',
  fsWrite: 'markup:fs:write',
  fsReadDir: 'markup:fs:readDir',
  fsWatch: 'markup:fs:watch',
  fsReadBase64: 'markup:fs:readBase64',
  dlOpen: 'markup:dialog:open',
  dlSave: 'markup:dialog:save',
  appOpenExternal: 'markup:app:openExternal',
  appOpenDevTools: 'markup:app:openDevTools',
  appSetTitle: 'markup:app:setTitle',
  appGetConfig: 'markup:app:getConfig',
  appSetConfig: 'markup:app:setConfig',
  appGetPath: 'markup:app:getPath',
  appPrint: 'markup:app:print',
  appExportPdf: 'markup:app:exportPdf',
  winMinimize: 'markup:win:minimize',
  winToggleMaximize: 'markup:win:toggleMaximize',
  winClose: 'markup:win:close',
  winConfirmClose: 'markup:win:confirmClose',
} as const