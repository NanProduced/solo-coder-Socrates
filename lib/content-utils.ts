export interface ContentMeta {
  title: string
  excerpt: string
  byline: string
  siteName: string
  url: string
}

const CHARS_PER_TOKEN_ZH = 1.5
const CHARS_PER_TOKEN_EN = 4

function estimateTokens(text: string): number {
  let zhChars = 0
  let enChars = 0

  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) {
      zhChars++
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      enChars++
    }
  }

  const otherChars = text.length - zhChars - enChars
  const zhTokens = zhChars / CHARS_PER_TOKEN_ZH
  const enTokens = enChars / CHARS_PER_TOKEN_EN
  const otherTokens = otherChars / CHARS_PER_TOKEN_EN

  return Math.ceil(zhTokens + enTokens + otherTokens)
}

interface Paragraph {
  index: number
  text: string
  isHeading: boolean
  charCount: number
}

function classifyParagraphs(content: string): Paragraph[] {
  const rawParagraphs = content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  return rawParagraphs.map((text, index) => {
    const isHeading =
      /^#{1,6}\s/.test(text) ||
      (text.length < 60 &&
        !/[.?!。？！]$/.test(text) &&
        !text.includes("，") &&
        (text.length < 20 || /^[A-Z]/.test(text)))

    return {
      index,
      text,
      isHeading,
      charCount: text.length,
    }
  })
}

export function smartTruncate(
  content: string,
  meta: ContentMeta,
  maxTokens: number = 20000
): string {
  const parts: string[] = []
  let usedTokens = 0

  const addPart = (text: string): boolean => {
    const tokens = estimateTokens(text)
    if (usedTokens + tokens > maxTokens) {
      return false
    }
    parts.push(text)
    usedTokens += tokens
    return true
  }

  if (meta.title) {
    addPart(`# ${meta.title}\n`)
  }

  if (meta.byline) {
    addPart(`作者: ${meta.byline}\n`)
  }

  if (meta.siteName) {
    addPart(`来源: ${meta.siteName}\n`)
  }

  if (meta.excerpt) {
    addPart(`\n> ${meta.excerpt}\n\n---\n`)
  }

  const paragraphs = classifyParagraphs(content)
  if (paragraphs.length === 0) {
    return parts.join("")
  }

  const mustInclude = new Set<number>()

  for (let i = 0; i < Math.min(5, paragraphs.length); i++) {
    mustInclude.add(i)
  }

  paragraphs.forEach((p, i) => {
    if (p.isHeading) {
      mustInclude.add(i)
      if (i + 1 < paragraphs.length && !paragraphs[i + 1].isHeading) {
        mustInclude.add(i + 1)
      }
    }
  })

  for (
    let i = Math.max(0, paragraphs.length - 3);
    i < paragraphs.length;
    i++
  ) {
    mustInclude.add(i)
  }

  const mustIncludeSorted = [...mustInclude].sort((a, b) => a - b)
  let lastIncludedIndex = -1

  for (const idx of mustIncludeSorted) {
    if (idx > lastIncludedIndex + 1) {
      addPart("\n[...]\n")
    }
    if (!addPart(paragraphs[idx].text + "\n\n")) {
      break
    }
    lastIncludedIndex = idx
  }

  if (usedTokens >= maxTokens * 0.9) {
    addPart("\n[...内容过长，已智能截断...]")
    return parts.join("")
  }

  let truncated = false
  for (let i = 0; i < paragraphs.length; i++) {
    if (mustInclude.has(i)) continue
    if (paragraphs[i].charCount < 15) continue

    if (!addPart(paragraphs[i].text + "\n\n")) {
      truncated = true
      break
    }
  }

  if (truncated || usedTokens >= maxTokens * 0.85) {
    addPart("\n[...内容过长，已智能截断...]")
  }

  return parts.join("")
}

export function buildContextPrompt(
  meta: ContentMeta,
  truncatedContent: string
): string {
  const isFile = meta.url.startsWith("file://")
  const isPdf = meta.url.toLowerCase().includes(".pdf")

  let prompt = ""
  if (isPdf) {
    prompt = "用户正在阅读一份 PDF 文档。"
  } else if (isFile) {
    prompt = "用户正在阅读一个本地文件。"
  } else {
    prompt = "用户正在浏览一个网页。"
  }

  if (meta.title) {
    prompt += `\n\n${isPdf ? "文档" : "网页"}标题：${meta.title}`
  }
  if (meta.url && !isFile) {
    try {
      const urlObj = new URL(meta.url)
      prompt += `\n网站：${urlObj.hostname}`
    } catch {}
  }
  if (isFile) {
    try {
      const urlObj = new URL(meta.url)
      const filename = urlObj.pathname.split("/").pop() || ""
      if (filename) {
        prompt += `\n文件名：${decodeURIComponent(filename)}`
      }
    } catch {}
  }
  if (meta.byline) {
    prompt += `\n作者：${meta.byline}`
  }
  if (meta.siteName) {
    prompt += `\n来源：${meta.siteName}`
  }

  prompt += `\n\n${isPdf ? "文档" : "网页"}内容：\n${truncatedContent}`

  return prompt
}
