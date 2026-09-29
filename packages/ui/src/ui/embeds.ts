/**
 * UI-side entry for core embeds. `shell`, `embedViewer` and the smoke tests
 * must all reach the same module instance (tsx keys the ESM cache by import
 * specifier), so everything in `src/ui` imports embeds through this file.
 */
export {
  MINDMAP_TEMPLATE,
  PLANTUML_TEMPLATE,
  hydrateEmbeds,
  normalizeEmbedLang,
  parseEmbedContent,
  renderEmbed,
  requestEmbedEnlarge,
  resolveEmbedSrc,
  resolveEmbedText,
  setEmbedEnlargeHandler,
  setEmbedSourceResolver,
  type EmbedContent,
  type EmbedEnlargeHandler,
  type EmbedEnlargeRequest,
  type EmbedKind,
  type EmbedSourceResolver,
} from '../../../core/src/embeds'
