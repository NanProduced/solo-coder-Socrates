import type { PlasmoContentScript } from "plasmo"
import Readability from "@mozilla/readability"

// 配置 Content Script 在所有页面自动注入
export const config: PlasmoContentScript = {
  matches: ["https://*/*", "http://*/*"],
  run_at: "document_idle"
}

// 消息类型定义
interface ExtractContentRequest {
  action: "extractContent"
}

interface ExtractContentResponse {
  success: boolean
  title?: string
  content?: string
  url?: string
  contentType?: "html" | "pdf" | "text"
  isTruncated?: boolean
  summary?: string
  error?: string
}

// 智能文本截断配置
const TRUNCATION_CONFIG = {
  maxContextTokens: 128000,
  reservedTokens: 2000,
  titleTokenWeight: 2,
  charToTokenRatio: 0.5,
  minParagraphs: 3,
  maxSummaryTokens: 500,
}

// 段落信息接口
interface ParagraphInfo {
  text: string
  length: number
  tokenEstimate: number
  isHeading: boolean
  position: number
}

// 估算文本的 token 数量
const estimateTokens = (text: string): number => {
  return Math.ceil(text.length * 0.8)
}

// 从文本中提取段落信息
const extractParagraphs = (text: string): ParagraphInfo[] => {
  const lines = text.split(/\n\n+/)
  const paragraphs: ParagraphInfo[] = []

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return

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

// 智能截断文本
const smartTruncate = (
  title: string,
  content: string,
  maxTokens: number = TRUNCATION_CONFIG.maxContextTokens - TRUNCATION_CONFIG.reservedTokens
) => {
  const totalTokens = estimateTokens(title) + estimateTokens(content)

  if (totalTokens <= maxTokens) {
    return {
      truncatedContent: content,
      isTruncated: false,
      totalLength: content.length,
      truncatedLength: content.length,
    }
  }

  const paragraphs = extractParagraphs(content)
  const titleTokens = estimateTokens(title) * TRUNCATION_CONFIG.titleTokenWeight
  const remainingTokens = maxTokens - titleTokens

  if (remainingTokens <= 0) {
    return {
      truncatedContent: "",
      isTruncated: true,
      totalLength: content.length,
      truncatedLength: 0,
      summary: "内容过长，已被完全截断",
    }
  }

  const selectedParagraphs: ParagraphInfo[] = []
  let usedTokens = 0

  // 1. 添加所有标题
  const headings = paragraphs.filter(p => p.isHeading)
  for (const heading of headings) {
    if (usedTokens + heading.tokenEstimate <= remainingTokens) {
      selectedParagraphs.push(heading)
      usedTokens += heading.tokenEstimate
    }
  }

  // 2. 添加开头段落（介绍部分）
  const introParagraphs = paragraphs.filter(p => !p.isHeading && p.position < 0.2)
  for (const para of introParagraphs.slice(0, 5)) {
    if (usedTokens + para.tokenEstimate <= remainingTokens) {
      selectedParagraphs.push(para)
      usedTokens += para.tokenEstimate
    }
  }

  // 3. 添加结尾段落（结论部分）
  const conclusionParagraphs = paragraphs.filter(p => !p.isHeading && p.position > 0.8)
  for (const para of conclusionParagraphs.slice(-3)) {
    if (usedTokens + para.tokenEstimate <= remainingTokens) {
      selectedParagraphs.push(para)
      usedTokens += para.tokenEstimate
    }
  }

  // 4. 从中间部分选择性添加较长的段落
  const middleParagraphs = paragraphs.filter(p => !p.isHeading && p.position >= 0.2 && p.position <= 0.8)
  const sortedMiddle = [...middleParagraphs].sort((a, b) => b.length - a.length)

  for (const para of sortedMiddle) {
    if (usedTokens + para.tokenEstimate <= remainingTokens) {
      selectedParagraphs.push(para)
      usedTokens += para.tokenEstimate
    }
  }

  // 按原始顺序排序
  selectedParagraphs.sort((a, b) => paragraphs.indexOf(a) - paragraphs.indexOf(b))

  const truncatedContent = selectedParagraphs.map(p => p.text).join("\n\n")
  const summary = `[内容已截断] 原文共 ${content.length} 字符 (约 ${totalTokens} tokens)，已保留 ${truncatedContent.length} 字符 (约 ${usedTokens} tokens)。保留了 ${selectedParagraphs.length} 个段落，包括标题、介绍部分、结论部分和重要的中间段落。`

  return {
    truncatedContent,
    isTruncated: true,
    totalLength: content.length,
    truncatedLength: truncatedContent.length,
    summary,
  }
}

// 清理 HTML 内容中的噪音
const cleanHtmlContent = (doc: Document): Document => {
  const clone = doc.cloneNode(true) as Document
  
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

// 使用 Readability 提取 HTML 正文
const extractHtmlWithReadability = (): { title: string; content: string } | null => {
  try {
    // 先清理文档
    const cleanedDoc = cleanHtmlContent(document)
    
    // 创建 Readability 实例 - 使用类型断言解决构造函数问题
    const ReadabilityClass = (Readability as any)
    const reader = new ReadabilityClass(cleanedDoc)
    const article = reader.parse()
    
    if (article) {
      return {
        title: article.title || document.title || "",
        content: article.textContent || "",
      }
    }
  } catch (e) {
    console.error("Readability extraction failed:", e)
  }
  
  return null
}

// 备用提取方法（当 Readability 失败时使用）
const extractWithFallback = (): { title: string; content: string } => {
  const title = document.title || ""
  
  const mainSelectors = [
    "main", "article", "[role='main']",
    ".post", ".article", ".content", "#content",
    ".post-content", ".article-content", ".entry-content",
    "[class*='content']", "[id*='content']",
  ]
  
  let mainContent = ""
  
  for (const selector of mainSelectors) {
    try {
      const element = document.querySelector(selector)
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
    const paragraphs = document.querySelectorAll("p")
    const texts: string[] = []
    let totalLength = 0
    
    paragraphs.forEach((p) => {
      const text = p.textContent?.trim() || ""
      if (text.length > 50) {
        texts.push(text)
        totalLength += text.length
        if (texts.length >= 50 || totalLength >= 20000) {
          return
        }
      }
    })
    
    mainContent = texts.join("\n\n")
  }
  
  // 如果还是没有内容，使用整个 body
  if (!mainContent || mainContent.trim().length < 100) {
    mainContent = document.body.textContent || ""
  }
  
  return { title, content: mainContent }
}

// 提取 HTML 页面内容
const extractHtmlContent = (): { title: string; content: string } => {
  // 首先尝试使用 Readability
  const readabilityResult = extractHtmlWithReadability()
  if (readabilityResult && readabilityResult.content.length > 100) {
    return readabilityResult
  }
  
  // 如果 Readability 失败，使用备用方法
  return extractWithFallback()
}

// 提取 PDF 内容
const extractPdfContent = (): { title: string; content: string; contentType: "pdf" } => {
  const url = window.location.href
  const title = document.title || "PDF Document"
  
  // 尝试从不同类型的 PDF 查看器中提取文本
  let content = ""
  
  // 1. 尝试查找文本层（许多现代 PDF 查看器使用）
  const textLayers = document.querySelectorAll('[class*="textLayer"], [id*="textLayer"]')
  if (textLayers.length > 0) {
    const texts: string[] = []
    textLayers.forEach(layer => {
      const text = layer.textContent?.trim() || ""
      if (text.length > 0) {
        texts.push(text)
      }
    })
    content = texts.join("\n\n")
  }
  
  // 2. 尝试查找 canvas 旁边的隐藏文本（某些查看器的做法）
  if (!content) {
    const hiddenTexts = document.querySelectorAll('span[style*="hidden"], div[style*="hidden"]')
    const texts: string[] = []
    hiddenTexts.forEach(el => {
      const text = el.textContent?.trim() || ""
      if (text.length > 20) {
        texts.push(text)
      }
    })
    if (texts.length > 0) {
      content = texts.join("\n\n")
    }
  }
  
  // 3. 尝试从 body 中提取所有文本（备用方案）
  if (!content) {
    content = document.body.textContent || ""
  }
  
  return { title, content, contentType: "pdf" }
}

// 提取纯文本内容
const extractTextContent = (): { title: string; content: string; contentType: "text" } => {
  const url = window.location.href
  const title = document.title || url
  const content = document.body.textContent || ""
  
  return { title, content, contentType: "text" }
}

// 主提取函数
const extractPageContent = (): ExtractContentResponse => {
  try {
    const pageType = detectPageType()
    const url = window.location.href
    
    let result: { title: string; content: string; contentType?: "html" | "pdf" | "text" }
    
    switch (pageType) {
      case "pdf":
        result = extractPdfContent()
        break
      case "text":
        result = extractTextContent()
        break
      case "html":
      default:
        result = { ...extractHtmlContent(), contentType: "html" }
    }
    
    // 应用智能截断
    const truncationResult = smartTruncate(result.title, result.content)
    
    return {
      success: true,
      title: result.title,
      content: truncationResult.truncatedContent,
      url,
      contentType: result.contentType,
      isTruncated: truncationResult.isTruncated,
      summary: truncationResult.summary,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    }
  }
}

// 监听来自 sidepanel 的消息
const addMessageListener = (chrome.runtime as any).onMessage?.addListener
if (addMessageListener) {
  addMessageListener((
    request: any,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtractContentResponse) => void
  ) => {
    if (request && request.action === "extractContent") {
      const result = extractPageContent()
      sendResponse(result)
    }
    
    // 返回 true 表示异步响应
    return true
  })
}

// 也可以通过 executeScript 直接调用此函数
// 这样当 sidepanel 使用 executeScript 时也能获取内容
(window as any).extractPageContentForExtension = extractPageContent
