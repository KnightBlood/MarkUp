/// <reference path="./styles.d.ts" />
import { setHost, type HostAPI } from '@markup/host-api'
import { renderShell } from './shell'

export async function boot(host: HostAPI): Promise<void> {
  setHost(host)
  renderShell()
  host.app.setTitle('Markup')
}

export * from './dom'
export { renderShell } from './shell'
export * from './ui/palette'
export * from './commands'
export * from './outline'
export * from './fuzzy'
export * from './findText'
export * from './workspace'
export * from './ui/findPanel'
export * from './ui/quickOpen'
export * from './ui/settings'
export * from './ui/messageDialog'
export * from './ui/contextMenu'
export * from './ui/formulaEditor'
export * from './mdLinks'
export * from './hostEvents'
export * from './appearance'