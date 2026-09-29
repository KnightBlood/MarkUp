declare module '@plantuml/core/plantuml.js' {
  export function render(
    lines: string[],
    targetId: string,
    options?: { dark?: boolean },
  ): void
  export function renderToString(
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (message: string) => void,
  ): void
}

declare module '*?url' {
  const src: string
  export default src
}

declare module 'node:module' {
  export function createRequire(url: string | URL): (id: string) => unknown
}
