import Readability from "@mozilla/readability"

// 智能文本截断的配置
const TRUNCATION_CONFIG = {
  // DeepSeek Chat v3.2 的上下文限制（保守估计）
  maxContextTokens: 128000,
  // 预留的消息 token 数
  reservedTokens: 2000,
  // 标题的 token 权重
  titleTokenWeight: 2,
  // 段落的 token 权重估算（每字符约 0.5 tokens）
  charToTokenRatio: 0.5,
  // 最小保留的段落数
  minParagraphs: 3,
  // 摘要的最大 token 数
  maxSummaryTokens: 500,
}

// 提取的内容类型
export interface ExtractedContent {
  title: string
  content: string
  url: string
  contentType: "html" | "pdf" | "text"
  isTruncated: boolean
  totalLength: number
  truncatedLength: number
  summary?: string
}

// 段落信息
interface ParagraphInfo {
  text: string
  length: number
  tokenEstimate: number
  isHeading: boolean
  position: number // 在文档中的位置百分比
}

// 检测页面类型
const detectPageType = (): "html" | "pdf" | "text" => {
  // 检查是否是 PDF 查看器页面
  if (document.contentType === "application/pdf" || 
      window.location.href.endsWith(".pdf") ||
      document.querySelector("embed[type='application/pdf']") ||
      document.querySelector("object[type='application/pdf']")) {
    return "pdf"
  }
  
  // 检查是否是纯文本页面
  if (document.contentType === "text/plain") {
    return "text"
  }
  
  return "html"
}

// 清理 HTML 内容中的噪音
const cleanHtmlContent = (doc: Document): Document => {
  const clone = doc.cloneNode(true) as Document
  
  // 移除常见的噪音元素
  const noiseSelectors = [
    "script", "style", "noscript", "iframe",
    "nav", "header", "footer", "aside",
    ".ad", ".ads", ".advertisement", ".advertising",
    ".banner", ".sidebar", ".widget",
    ".comments", ".comment-section",
    ".social", ".share", ".like",
    ".related", ".recommended", ".trending",
    ".cookie", ".gdpr", ".consent",
    ".popup", ".modal", ".overlay",
    "#ad", "#ads", "#advertisement",
    "#sidebar", "#widget",
    "[role='banner']", "[role='complementary']",
    "[data-ad]", "[class*='ad-']",
    "[id*='ad-']",
  ]
  
  noiseSelectors.forEach(selector => {
    try {
      const elements = clone.querySelectorAll(selector)
      elements.forEach(el => el.remove())
    } catch (e) {
      // 忽略无效选择器
    }
  })
  
  // 移除空的段落和容器
  const emptyElements = clone.querySelectorAll("p:empty, div:empty, span:empty")
  emptyElements.forEach(el => {
    if (el.textContent?.trim() === "") {
      el.remove()
    }
  })
  
  return clone
}

// 使用 Readability 提取正文
const extractWithReadability = (doc: Document): { title: string; content: string } | null => {
  try {
    // 先清理文档
    const cleanedDoc = cleanHtmlContent(doc)
    
    // 创建 Readability 实例
    const reader = new (Readability as any)(cleanedDoc)
    const article = reader.parse()
    
    if (article) {
      return {
        title: article.title || "",
        content: article.textContent || "",
      }
    }
  } catch (e) {
    console.error("Readability extraction failed:", e)
  }
  
  return null
}

// 备用提取方法（当 Readability 失败时使用）
const extractWithFallback = (doc: Document): { title: string; content: string } => {
  const title = doc.title || ""
  
  // 尝试查找主要内容区域
  const mainSelectors = [
    "main", "article", "[role='main']",
    ".post", ".article", ".content", "#content",
    ".post-content", ".article-content", ".entry-content",
    "[class*='content']", "[id*='content']",
  ]
  
  let mainContent = ""
  
  for (const selector of mainSelectors) {
    try {
      const element = doc.querySelector(selector)
      const textContent = element?.textContent ?? ""
      if (element && textContent.trim().length > 500) {
        mainContent = textContent
        break
      }
    } catch (e) {
      continue
    }
  }
  
  // 如果没有找到主要内容区域，收集所有段落
  if (!mainContent) {
    const paragraphs = doc.querySelectorAll("p")
    const texts: string[] = []
    let totalLength = 0
    
    paragraphs.forEach((p, i) => {
      const text = p.textContent?.trim() || ""
      if (text.length > 50) { // 只保留有意义的段落
        texts.push(text)
        totalLength += text.length
        // 限制收集的段落数量和总长度
        if (texts.length >= 50 || totalLength >= 20000) {
          return
        }
      }
    })
    
    mainContent = texts.join("\n\n")
  }
  
  // 如果还是没有内容，使用整个 body
  if (!mainContent || mainContent.trim().length < 100) {
    mainContent = doc.body.textContent || ""
  }
  
  return { title, content: mainContent }
}

// 估算文本的 token 数量（基于字符数的简单估算）
const estimateTokens = (text: string): number => {
  // 对于中文，每字符约 1-2 tokens
  // 对于英文，每 4 字符约 1 token
  // 这里使用保守的估算：每字符 0.8 tokens
  return Math.ceil(text.length * 0.8)
}

// 从文本中提取段落信息
const extractParagraphs = (text: string): ParagraphInfo[] => {
  const lines = text.split(/\n\n+/)
  const paragraphs: ParagraphInfo[] = []
  
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    
    // 检测是否是标题（短文本，可能全大写或以数字开头）
    const isHeading = 
      trimmed.length < 100 && 
      (trimmed === trimmed.toUpperCase() || 
       /^\d+[\.\)]/.test(trimmed) ||
       /^[一二三四五六七八九十]+[、\.]/.test(trimmed))
    
    paragraphs.push({
      text: trimmed,
      length: trimmed.length,
      tokenEstimate: estimateTokens(trimmed),
      isHeading,
      position: index / lines.length,
    })
  })
  
  return paragraphs
}

// 智能截断文本，保留标题、关键段落和摘要
const smartTruncate = (
  title: string,
  content: string,
  maxTokens: number = TRUNCATION_CONFIG.maxContextTokens - TRUNCATION_CONFIG.reservedTokens
): { truncatedContent: string; isTruncated: boolean; totalLength: number; truncatedLength: number; summary?: string } => {
  const totalTokens = estimateTokens(title) + estimateTokens(content)
  
  // 如果内容已经在限制内，直接返回
  if (totalTokens <= maxTokens) {
    return {
      truncatedContent: content,
      isTruncated: false,
      totalLength: content.length,
      truncatedLength: content.length,
    }
  }
  
  const paragraphs = extractParagraphs(content)
  
  // 标题的 token 成本
  const titleTokens = estimateTokens(title) * TRUNCATION_CONFIG.titleTokenWeight
  const remainingTokens = maxTokens - titleTokens
  
  if (remainingTokens <= 0) {
    // 即使只有标题也超过限制，只能截断标题
    return {
      truncatedContent: "",
      isTruncated: true,
      totalLength: content.length,
      truncatedLength: 0,
      summary: "内容过长，已被完全截断",
    }
  }
  
  // 策略：
  // 1. 优先保留所有标题
  // 2. 保留开头的几个段落（介绍部分）
  // 3. 保留结尾的几个段落（结论部分）
  // 4. 中间部分选择性保留重要段落
  
  const selectedParagraphs: ParagraphInfo[] = []
  let usedTokens = 0
  
  // 第一步：添加所有标题
  const headings = paragraphs.filter(p => p.isHeading)
  for (const heading of headings) {
    if (usedTokens + heading.tokenEstimate <= remainingTokens) {
      selectedParagraphs.push(heading)
      usedTokens += heading.tokenEstimate
    }
  }
  
  // 第二步：添加开头段落
  const introParagraphs = paragraphs.filter(p => !p.isHeading && p.position < 0.2)
  for (const para of introParagraphs.slice(0, 5)) {
    if (usedTokens + para.tokenEstimate <= remainingTokens) {
      selectedParagraphs.push(para)
      usedTokens += para.tokenEstimate
    }
  }
  
  // 第三步：添加结尾段落
  const conclusionParagraphs = paragraphs.filter(p => !p.isHeading && p.position > 0.8)
  for (const para of conclusionParagraphs.slice(-3)) {
    if (usedTokens + para.tokenEstimate <= remainingTokens) {
      selectedParagraphs.push(para)
      usedTokens += para.tokenEstimate
    }
  }
  
  // 第四步：从中间部分选择性添加较长的段落（通常包含更多信息）
  const middleParagraphs = paragraphs.filter(p => !p.isHeading && p.position >= 0.2 && p.position <= 0.8)
  // 按长度排序，优先保留较长的段落
  const sortedMiddle = [...middleParagraphs].sort((a, b) => b.length - a.length)
  
  for (const para of sortedMiddle) {
    if (usedTokens + para.tokenEstimate <= remainingTokens) {
      selectedParagraphs.push(para)
      usedTokens += para.tokenEstimate
    }
  }
  
  // 按原始顺序排序
  selectedParagraphs.sort((a, b) => paragraphs.indexOf(a) - paragraphs.indexOf(b))
  
  // 构建截断后的内容
  const truncatedContent = selectedParagraphs.map(p => p.text).join("\n\n")
  
  // 生成摘要信息
  const summary = `[内容已截断] 原文共 ${content.length} 字符 (约 ${totalTokens} tokens)，已保留 ${truncatedContent.length} 字符 (约 ${usedTokens} tokens)。保留了 ${selectedParagraphs.length} 个段落，包括标题、介绍部分、结论部分和重要的中间段落。`
  
  return {
    truncatedContent,
    isTruncated: true,
    totalLength: content.length,
    truncatedLength: truncatedContent.length,
    summary,
  }
}

// 提取 HTML 页面内容
export const extractHtmlContent = (): ExtractedContent => {
  const url = window.location.href
  
  // 首先尝试使用 Readability
  let result = extractWithReadability(document)
  
  // 如果 Readability 失败，使用备用方法
  if (!result) {
    result = extractWithFallback(document)
  }
  
  // 智能截断
  const truncationResult = smartTruncate(result.title, result.content)
  
  return {
    title: result.title,
    content: truncationResult.truncatedContent,
    url,
    contentType: "html",
    isTruncated: truncationResult.isTruncated,
    totalLength: truncationResult.totalLength,
    truncatedLength: truncationResult.truncatedLength,
    summary: truncationResult.summary,
  }
}

// 提取 PDF 内容（占位函数，需要在浏览器环境中实现）
export const extractPdfContent = (): ExtractedContent => {
  // 这个函数需要在浏览器环境中运行，并且需要 pdf.js 的支持
  // 我们将在 sidepanel.tsx 中实现完整的 PDF 提取逻辑
  const url = window.location.href
  const title = document.title || "PDF Document"
  
  return {
    title,
    content: "",
    url,
    contentType: "pdf",
    isTruncated: false,
    totalLength: 0,
    truncatedLength: 0,
  }
}

// 提取纯文本内容
export const extractTextContent = (): ExtractedContent => {
  const url = window.location.href
  const title = document.title || url
  const content = document.body.textContent || ""
  
  const truncationResult = smartTruncate(title, content)
  
  return {
    title,
    content: truncationResult.truncatedContent,
    url,
    contentType: "text",
    isTruncated: truncationResult.isTruncated,
    totalLength: truncationResult.totalLength,
    truncatedLength: truncationResult.truncatedLength,
    summary: truncationResult.summary,
  }
}

// 主提取函数
export const extractPageContent = (): ExtractedContent => {
  const pageType = detectPageType()
  
  switch (pageType) {
    case "pdf":
      return extractPdfContent()
    case "text":
      return extractTextContent()
    case "html":
    default:
      return extractHtmlContent()
  }
}

// 导出配置以便外部使用
export { TRUNCATION_CONFIG }
