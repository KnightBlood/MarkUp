import { boot, showHostMessage } from '@markup/ui'
import type { HostAPI } from '@markup/host-api'
import { HOST_MESSAGE_REQUEST, type HostMessageRequest } from '../../shared/ipc'

// contextBridge exposes window.__HOST__ read-only, so preload relays
// dialog.message here: render the shared in-app <dialog> and answer with
// the chosen button on a per-request DOM event.
document.addEventListener(HOST_MESSAGE_REQUEST, (event) => {
  const { reply, options } = (event as CustomEvent<HostMessageRequest>).detail
  void showHostMessage(options).then((result) => {
    document.dispatchEvent(new CustomEvent(reply, { detail: result }))
  })
})

const host = window.__HOST__
if (!host) throw new Error('preload 未注入 __HOST__')

void boot(host as HostAPI)
