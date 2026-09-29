import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  HOST_EVENT_CHANNEL,
  HOST_MESSAGE_REQUEST,
  IPC_CHANNELS,
  type HostMessageRequest,
} from '../../shared/ipc'
import type {
  AppConfig,
  FsEvent,
  HostAPI,
  HostEvent,
  MessageOptions,
  MessageResult,
} from '@markup/host-api'

interface HostMessage {
  event: string
  payload: unknown
}

let messageSeq = 0

function onHostMessage(event: HostEvent, listener: (payload: unknown) => void): () => void {
  const wrapper = (_eventArg: IpcRendererEvent, message: HostMessage): void => {
    if (message.event === event) listener(message.payload)
  }
  ipcRenderer.on(HOST_EVENT_CHANNEL, wrapper)
  return () => {
    ipcRenderer.removeListener(HOST_EVENT_CHANNEL, wrapper)
  }
}

const api: HostAPI = {
  platform: 'electron',
  fs: {
    read: (path) => ipcRenderer.invoke(IPC_CHANNELS.fsRead, path),
    write: (path, content) => ipcRenderer.invoke(IPC_CHANNELS.fsWrite, path, content),
    readDir: (path) => ipcRenderer.invoke(IPC_CHANNELS.fsReadDir, path),
    readBase64: (path) => ipcRenderer.invoke(IPC_CHANNELS.fsReadBase64, path),
    watch: (path, listener) => {
      const off = onHostMessage('fs-changed', (payload) => {
        listener(payload as FsEvent)
      })
      void ipcRenderer.invoke(IPC_CHANNELS.fsWatch, path)
      return off
    },
  },
  dialog: {
    open: (options) => ipcRenderer.invoke(IPC_CHANNELS.dlOpen, options),
    save: (options) => ipcRenderer.invoke(IPC_CHANNELS.dlSave, options),
    message: (options: MessageOptions): Promise<MessageResult> =>
      new Promise((resolve) => {
        // The popup is renderer-side UI (shared in-app <dialog>): preload
        // relays the request over a DOM event and waits for the reply event
        // carrying the chosen button.
        messageSeq += 1
        const reply = `markup:host-message-reply:${messageSeq}`
        const onReply = (event: Event): void => {
          document.removeEventListener(reply, onReply)
          resolve((event as CustomEvent<MessageResult>).detail)
        }
        document.addEventListener(reply, onReply)
        document.dispatchEvent(
          new CustomEvent(HOST_MESSAGE_REQUEST, {
            detail: { reply, options } satisfies HostMessageRequest,
          }),
        )
      }),
  },
  app: {
    openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.appOpenExternal, url),
    openDevTools: () => void ipcRenderer.invoke(IPC_CHANNELS.appOpenDevTools),
    setTitle: (title) => void ipcRenderer.invoke(IPC_CHANNELS.appSetTitle, title),
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.appGetConfig),
    setConfig: (config: AppConfig) => void ipcRenderer.invoke(IPC_CHANNELS.appSetConfig, config),
      getPath: (name: 'plugins' | 'pluginsLocal' | 'userData') =>
        ipcRenderer.invoke(IPC_CHANNELS.appGetPath, name),
    on: (event, listener) => onHostMessage(event, (payload) => listener(payload as never)),
    print: (html?: string) => ipcRenderer.invoke(IPC_CHANNELS.appPrint, html),
    exportPdf: (path: string, html: string) => ipcRenderer.invoke(IPC_CHANNELS.appExportPdf, path, html),
  },
  window: {
    minimize: () => void ipcRenderer.invoke(IPC_CHANNELS.winMinimize),
    toggleMaximize: () => void ipcRenderer.invoke(IPC_CHANNELS.winToggleMaximize),
    close: () => void ipcRenderer.invoke(IPC_CHANNELS.winClose),
    confirmClose: () => void ipcRenderer.invoke(IPC_CHANNELS.winConfirmClose),
  },
}

contextBridge.exposeInMainWorld('__HOST__', api)