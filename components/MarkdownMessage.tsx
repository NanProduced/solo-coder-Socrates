import { useMemo } from "react"

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

interface MarkdownMessageProps {
  content: string
  isUser: boolean
}

export const MarkdownMessage = ({ content, isUser }: MarkdownMessageProps) => {
  const renderedHTML = useMemo(() => {
    let html = content

    const codeBlocks: string[] = []
    html = html.replace(/```(\w+)?\s*\n([\s\S]*?)\n```/g, (match, lang, code) => {
      codeBlocks.push(escapeHtml(code))
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`
    })

    const inlineCodes: string[] = []
    html = html.replace(/`([^`]+)`/g, (match, code) => {
      inlineCodes.push(escapeHtml(code))
      return `__INLINE_CODE_${inlineCodes.length - 1}__`
    })

    html = escapeHtml(html)

    html = html.replace(/^#\s+(.+)$/gm, '<h1 class="text-lg font-bold mb-3 mt-4">$1</h1>')
    html = html.replace(/^##\s+(.+)$/gm, '<h2 class="text-base font-bold mb-2 mt-3">$1</h2>')
    html = html.replace(/^###\s+(.+)$/gm, '<h3 class="text-sm font-bold mb-2 mt-2">$1</h3>')

    html = html.replace(/^[-*+]\s+(.+)$/gm, '<li class="text-sm">$1</li>')
    html = html.replace(/(<li.*<\/li>\n?)+/g, '<ul class="list-disc pl-4 mb-2 space-y-1">$&</ul>')

    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="text-sm">$1</li>')
    html = html.replace(/(<li.*<\/li>\n?)+/g, (match) => {
      if (match.includes('class="list-disc')) return match
      return `<ol class="list-decimal pl-4 mb-2 space-y-1">${match}</ol>`
    })

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold">$1</strong>')
    html = html.replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')

    html = html.replace(/^&gt;\s+(.+)$/gm, (match, text) => {
      return `<blockquote class="border-l-2 pl-3 py-1 my-2 ${isUser ? 'border-white/50' : 'border-gray-300 text-gray-600'}">${text}</blockquote>`
    })

    html = html.replace(/\n\n/g, '</p><p class="mb-2 last:mb-0">')
    html = html.replace(/\n/g, '<br/>')

    if (html && !html.startsWith('<')) {
      html = '<p class="mb-2 last:mb-0">' + html + '</p>'
    }

    html = html.replace(/__INLINE_CODE_(\d+)__/g, (match, index) => {
      const code = inlineCodes[parseInt(index)]
      const bgClass = isUser ? 'bg-white/20' : 'bg-notion-bg-secondary text-notion-text'
      return `<code class="px-1.5 py-0.5 rounded text-xs font-mono ${bgClass}">${code}</code>`
    })

    html = html.replace(/__CODE_BLOCK_(\d+)__/g, (match, index) => {
      const code = codeBlocks[parseInt(index)]
      return `<pre class="my-2"><code class="block px-3 py-2 rounded bg-notion-bg-secondary text-notion-text text-xs font-mono overflow-x-auto">${code}</code></pre>`
    })

    return html
  }, [content, isUser])

  return (
    <div
      className="text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: renderedHTML }}
    />
  )
}
