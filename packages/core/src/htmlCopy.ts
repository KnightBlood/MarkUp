/**
 * 复制内容并简化格式 — strip presentational attributes from copied HTML.
 *
 * What gets copied out of a view is *our* markup: it carries inline `style`
 * attributes and a `<style>` block that describe how it looks **here**. Pasted
 * anywhere else those either do nothing or fight the destination's own styling,
 * which is exactly what "简化格式" is for.
 *
 * Only presentation is removed. Classes and semantic wrappers stay — they carry
 * meaning (a callout is a `.md-alert`, a task item is a checkbox), and a pasted
 * fragment that lost its structure would be a worse outcome than one that kept a
 * few class names nobody styles.
 */

/** Drop `<style>` blocks and `style` attributes. */
export function stripHtmlFormatting(html: string): string {
  return (
    html
      // A whole stylesheet has no meaning once detached from its document.
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      // Inline presentation: `style="…"` / `style='…'` / bare `style=a:b`.
      .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  )
}

/** True when stripping changed nothing, so a caller can skip a redundant pass. */
export function hasInlineFormatting(html: string): boolean {
  return /<style\b|\sstyle\s*=/i.test(html)
}
