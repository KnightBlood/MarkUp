/**
 * RPC contract between the Electrobun Bun main process and the view.
 *
 * Electrobun exposes exactly one typed channel per side
 * (`.hutch/devkit/api/shared/rpc.ts`):
 *
 *   `bun.requests`      – requests the Bun process serves (view -> host)
 *   `webview.messages`  – fire-and-forget host events (host -> view)
 *
 * Everything the other shells spread over many IPC channels rides these two,
 * so a single `host-event` envelope carries every {@link HostEventMap} entry,
 * mirroring the single `host-event` channel the Electron/Wails/Tauri shells use.
 */
import type {
  AppConfig,
  DirEntry,
  FileResult,
  HostEvent,
  HostEventMap,
  MessageOptions,
  MessageResult,
  OpenDialogOptions,
  PathInfo,
  SaveDialogOptions,
} from '../../../packages/host-api/src/types'

/** Requests served by the Bun main process. Every entry needs `params` so the
 *  schema satisfies Electrobun's `BaseRPCRequestsSchema`; `void` keeps
 *  argument-less calls optional (`rpc.request.appGetConfig()`). */
export type HostRequests = {
  fsRead: { params: string; response: FileResult }
  fsWrite: { params: { path: string; content: string }; response: void }
  fsReadDir: { params: string; response: DirEntry[] }
  fsWatch: { params: string; response: void }
  fsUnwatch: { params: string; response: void }
  fsReadBase64: { params: string; response: string }
  dialogOpen: { params: OpenDialogOptions; response: PathInfo[] }
  dialogSave: { params: SaveDialogOptions; response: PathInfo | null }
  appOpenExternal: { params: string; response: void }
  appSetTitle: { params: string; response: void }
  appOpenDevTools: { params: void; response: void }
  appGetConfig: { params: void; response: AppConfig }
  appSetConfig: { params: AppConfig; response: void }
  appGetPath: {
    params: 'plugins' | 'pluginsLocal' | 'userData'
    response: string | null
  }
  appPrint: { params: string | undefined; response: boolean }
  appExportPdf: { params: { path: string; html: string }; response: boolean }
  winMinimize: { params: void; response: void }
  winToggleMaximize: { params: void; response: void }
  winClose: { params: void; response: void }
  winConfirmClose: { params: void; response: void }
  winIsMaximized: { params: void; response: boolean }
}

/** Single-channel host -> view envelope, same shape the other shells use. */
export interface HostEventEnvelope {
  event: HostEvent
  payload: HostEventMap[HostEvent]
}

export type HostEventMessages = {
  'host-event': HostEventEnvelope
}

/**
 * The Electrobun schema. `bun.*` is what the main process serves/sends;
 * `webview.*` is what the view serves/sends.
 */
export type AppRPC = {
  bun: {
    requests: HostRequests
    messages: Record<string, never>
  }
  webview: {
    requests: Record<string, never>
    messages: HostEventMessages
  }
}
